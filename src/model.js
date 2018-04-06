import {OrderedSet, Record, fromJS} from 'immutable'

import {BaseInstance} from './instance'
import {isEmpty, iterRecord, getDiffOp, ModelError} from './utils'
import Field from './field'

export default class Model {

  constructor(type, options) {
    this.type = type
    if(options)
      this.merge(options)
  }

  /**
   * Merge endpoint operations. Place the operations on the model
   * itself.
   */
  merge(options) {
    this.idField = options.idField || 'id'
    this.attributes = fromJS(options.attributes || {})
    this.relationships = fromJS(options.relationships || {})
    this.indices = fromJS(options.indices || ['id'])
    this.ops = {}
    this._makeRecord()
    this._makeInstanceSubclass()

    // Build a list of all possible operations, then check if
    // it's been set in options.
    let operations = ['list', 'create', 'detail', 'update', 'remove', 'options']
    for (const field of this.iterManyToMany()) {
      operations.push(field + 'Add')
      operations.push(field + 'Remove')
    }
    for (const key of operations) {
      if (options.ops && key in options.ops) {
        this.ops[key] = (...args) => options.ops[key](...args).then(data => {
          console.debug(`Model: ${key}: `, data)
          return data
        })
      }
    }
  }

  _makeRecord() {
    let data = {
      _type: null,
      [this.idField]: null
    }
    this.attributes.forEach((attr, name) => {
      data[name] = attr.get('default', null)
    })
    this.relationships.forEach((rel, name) => {
      data[name] = rel.get('many') ? new OrderedSet() : null
    })
    this._record = Record(data)
  }

  /**
   * Add attribute getters/setters to object.
   */
  addAttributesToObject(obj) {
    for(const name of this.attributes.keys()) {
      Object.defineProperty(obj, name, {
        get: function() {
          return this._values.get(name)
        },
        set: function(x) {
          this._values = this._values.set(name, x)
        }
      })
    }
  }

  /**
   * Add relationship getters/setters to object.
   */
  addRelationshipsToObject(obj) {
    for (const name of this.relationships.keys()) {
      const rel = this.relationships.get(name)
      if (rel.get('many')) {
        Object.defineProperty(obj, name, {
          get: function() {
            return {
              all: () => {
                return (this._values.get(name) || []).map(x =>
                  this._db.getInstance(x)
                )
              },
              add: x => {
                if (rel.get('reverse'))
                  throw new ModelError('Cannot set reverse relationships.')
                this._values = this._values.updateIn([name], y => {
                  return y.add(this._db.getId(x))
                })
              },
              remove: x => {
                this._values = this._values.updateIn([name], y =>
                  y.remove(this._db.getId(x))
                )
              }
            }
          },
          set: function(x) {
            throw ModelError('Cannot directly set many-to-many.')
          }
        })
      }
      else {

        // The getter for foriegn-keys will return an Instance object
        // if one exists, and undefined otherwise.
        Object.defineProperty(obj, name, {
          get: function() {
            let value = this._values.get(name)

            // Without a DB object the best we can do is return the
            // ID of the foreign-key.
            if(!this._db)
              return value

            // TODO: Use db.get once I've converted it.
            let obj = this._db.get(value)
            if(obj)
              obj = this._db.schema.toInstance(obj, this._db)
            return obj
          },
          set: function(x) {
            if(x)
              this._values = this._values.set(name, this._db.getId(x))
            else
              this._values = this._values.set(name, x)
          }
        })
      }
    }
  }

  /**
   * Make a model specific instance class.
   *
   * Creating Instance classes tends to involve a lot of iterating
   * over fields and adding methods to classes. Here we define an
   * anonymous class prebuilt with the setters and getters, so we
   * don't need to do it each time we send back an instance.
   */
  _makeInstanceSubclass() {
    this.Instance = class extends BaseInstance {
    }
    this.addAttributesToObject(this.Instance.prototype)
    this.addRelationshipsToObject(this.Instance.prototype)
  }

  addReverseRelationship( field, relation ) {
    if( !this.relationships.has( field ) ) {
      this.relationships = this.relationships.set( field, relation )
      this._makeRecord()
      this._makeInstanceSubclass()
    }
    // TODO: Check that the fields are compatible
  }

  update(rec, values) {
    return rec.merge(this.toData(values))
  }

  toInstance(rec, db) {
    return new this.Instance(rec, this, db)
  }

  // TODO: Rename to "toRecord"
  toObject(data) {
    return new this._record(this.toData(data))
  }

  // TODO: Rename to "toObject"
  toData(data) {
    let obj = {
      _type: this.type,
      id: data.id
    }
    for (const fldName of iterRecord(data || {}))
      obj[fldName] = this.toInternal(fldName, data[fldName])
    return obj
  }

  fromRecord(rec) {
    let data = {
      _type: this.type,
      id: rec.id
    }
    for (const fldName of iterRecord(rec || {})) {
      let v = rec[fldName]
      this.switchOnField(fldName, {
        attribute: function(fld) {
          data[fldName] = Field.fromInternal(fld.get('type'), v)
        },
        foreignKey: function(fld) {
          data[fldName] = Field.fromInternal('foreignkey', v)
        },
        manyToMany: function(fld) {
          data[fldName] = Field.fromInternal('manytomany', v)
        }
      })
    }
    return data
  }

  toIndexable(fldName, value) {
    let r
    if (fldName == 'id') {
      if (isEmpty(value))
        r = null
      else
        r = `${value}`
    }
    else {
      this.switchOnField(fldName, {
        attribute: function(fld) {
          r = Field.toIndexable(fld.get('type'), value)
        },
        foreignKey: function(fld) {
          r = Field.toIndexable('foreignkey', value)
        },
        manyToMany: function(fld) {
          r = Field.toIndexable('manytomany', value)
        }
      })
    }
    return r
  }

  toInternal(fldName, value) {
    return this._fieldOp(fldName, type => Field.toInternal(type, value), value)
  }

  equals(fldName, a, b) {
    return this._fieldOp(fldName, type => Field.equals(type, a, b))
  }

  lookup(record, fields) {
    if (!Array.isArray(fields))
      fields = fields.split('__')
    if (fields.length > 1)
      for (const f of fields.slice(0, fields.length - 1))
        obj = this.get(obj[f])
    return obj[fields[fields.length - 1]]
  }

  _fieldOp(fldName, callback, defaultValue) {
    let r = defaultValue
    this.switchOnField(fldName, {
      attribute: function(fld) {
        r = callback(fld.get('type'))
      },
      foreignKey: function(fld) {
        r = callback('foreignkey')
      },
      manyToMany: function(fld) {
        r = callback('manytomany')
      }
    })
    return r
  }

  * iterFields(opts) {
    yield '_type'
    yield 'id'
    for (const x of this.attributes.keys())
      yield x
    for (const x of this.iterRelationships(opts))
      yield x
  }

  *iterAttributes() {
    for(const x of this.attributes.keys())
      yield x
  }

  *iterRelationships( opts ) {
    for( const x of this.iterForeignKeys( opts ) )
      yield x
    for( const x of this.iterManyToMany( opts ) )
      yield x
  }

  *iterManyToMany( opts ) {
    const { includeReverse = false } = opts || {}
    for( const field of this.relationships.keys() ) {
      if( (!includeReverse && this.relationships.getIn( [field, 'reverse'] ))
          || !this.relationships.getIn( [field, 'many'] ) )
      {
        continue
      }
      yield field
    }
  }

  *iterForeignKeys( opts ) {
    const { includeReverse = false } = opts || {}
    for( const field of this.relationships.keys() ) {
      if( (!includeReverse && this.relationships.getIn( [field, 'reverse'] ))
          || this.relationships.getIn( [field, 'many'] ) )
      {
        continue
      }
      yield field
    }
  }

  fieldIsAttribute(name) {
    const fld = this.attributes.get(name)
    return fld !== undefined
  }

  fieldIsForeignKey( field ) {
    const info = this.relationships.get( field )
    if( info === undefined )
      return false
    return !info.get( 'many' )
  }

  fieldIsManyToMany( field ) {
    const info = this.relationships.get( field )
    if( info === undefined ) {
      return false
    }
    return info.get( 'many' )
  }

  fieldIsRelationship( field ) {
    const info = this.relationships.get( field )
    if( info === undefined )
      return false
    return true
  }

  getField(name) {
    let field = this.attributes.get(name)
    if (field === undefined) {
      if (!this.relationships.has(name))
        throw new ModelError(`Model ${this.type} has no field ${name}.`)
      field = this.relationships.get(name)
    }
    return field
  }

  getFieldType(name) {
    const fld = this.getField(name)
    if (this.fieldIsAttribute(name))
      return fld.get('type')
    else
      return fld.get('many') ? 'manytomany' : 'foreignkey'
  }

  getFieldDefault(name) {
    const fld = this.getField(name)
    return fld.get('default')
  }

  diff(fromObj, toObj) {
    let diff = {}

    // Check for creation.
    if (isEmpty(fromObj)) {
      if (isEmpty(toObj))
        return null
      for (const fldName of this.iterFields()) {
        if (toObj[fldName] !== undefined)
          diff[fldName] = [undefined, toObj[fldName]]
      }
    }

    // Check for remove.
    else if (isEmpty(toObj)) {
      for (const field of this.iterFields()) {
        if (fromObj[field] !== undefined)
          diff[field] = [fromObj[field], undefined]
      }
    }

    // Use field differences.
    else {
      for (const fldName of this.iterFields()) {
        const f = fromObj[fldName]
        const t = toObj[fldName]
        let d
        this.switchOnField(fldName, {
          attribute: fld => {
            d = Field.diff(fld.get('type'), f, t)
          },
          foreignKey: fld => {
            d = Field.diff('foreignkey', f, t)
          },
          manyToMany: fld => {
            d = Field.diff('manytomany', f, t)
          }
        })
        if (d)
          diff[fldName] = d
      }
      if (Object.keys(diff).length) {
        diff._type = [fromObj._type, toObj._type]
        diff.id = [fromObj.id, toObj.id]
      }
    }

    return Object.keys(diff).length ? diff : null
  }

  applyDiff(rec, diff, reverse) {
    if (!isEmpty(diff)) {
      const ii = reverse ? 1 : 0
      const jj = reverse ? 0 : 1

      // Creation.
      if (isEmpty(diff._type[ii])) {
        if (!isEmpty(rec))
          throw new ModelError('Trying to create an object that already exists.')
        let data = {}
        Object.keys(diff).forEach(x => data[x] = diff[x][jj])
        rec = this.toObject(data)
      }

      // Removal.
      else if (isEmpty(diff._type[jj])) {
        if (isEmpty(rec))
          throw new ModelError('Trying to remove an object that doesn\'t exist.')
        rec = null
      }

      // Update.
      else {
        for (const fldName of Object.keys(diff)) {
          if (['id', '_type'].includes(fldName))
            continue
          const v = rec.get(fldName)
          const d = diff[fldName]
          let r
          this.switchOnField(fldName, {
            attribute: fld => {
              r = Field.applyDiff(fld.get('type'), v, d, reverse)
            },
            foreignKey: fld => {
              r = Field.applyDiff('foreignkey', v, d, reverse)
            },
            manyToMany: fld => {
              r = Field.applyDiff('manytomany', v, d, reverse)
            }
          })
          rec = rec.set(fldName, r)
        }
      }

    }
    return rec
  }

  diffToJsonApi(diff) {
    let data = {
      type: diff._type[1],
      id: diff.id[1],
      attributes: {},
      relationships: {}
    }
    const op = getDiffOp(diff)
    if (op == 'remove') {
      data.type = diff._type[0]
      data.id = diff.id[0]
    }
    for (const fldName of this.iterAttributes()) {
      if (fldName in diff) {
        const fld = this.getField(fldName)
        data.attributes[fldName] = Field.fromInternal(fld.get('type'), diff[fldName][1])
      }
    }
    for (const fldName of this.iterForeignKeys()) {
      if (fldName in diff) {
        const v = diff[fldName][1]
        data.relationships[fldName] = {
          data: v ? {type: v._type, id: v.id} : null
        }
      }
    }
    return {data}
  }

  switchOnField( field, ops ) {
    let call
    let info = this.relationships.get( field )
    if( info !== undefined ) {
      if( info.get( 'many' ) ) {
        call = ops.manyToMany
      }
      else {
        call = ops.foreignKey
      }
    }
    else {
      info = this.attributes.get( field )
      if( info !== undefined ) {
        call = ops.attribute
      }
    }
    if( call ) {
      call(info)
    }
  }
}
