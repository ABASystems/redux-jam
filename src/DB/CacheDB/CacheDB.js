import uuid from 'uuid'
import {List, Map, Set, OrderedSet} from 'immutable'

import Table from './table'
import {
  toArray, makeIID, getDiffOp, getDiffId, isObject, toIterable,
  ModelError, splitJsonApiResponse, saveJson, loadJson,
  isEmpty, argopts
} from './utils'
import {executionTime} from './debug'

export default class CacheDB extends BaseDB {

  static isCacheDB(value) {
    return value instanceof CacheDB
  }

  constructor(options) {
    const {data, schema} = options
    this.schema = schema
    if (Map.isMap(data))
      this.data = data
    else
      this.reset(data)
  }

  reset(data) {
    this.data = new Map({
      head: new Map(),
      tail: new Map(),
      deltas: new List(),
      tailptr: 0,
      queries: new Map()
    })
    if (data) {
      if (data.tail) {
        Object.keys(data.tail).forEach(type => {
          let tbl = new Table(type, {data: data.tail[type], db: this})
          this.data = this.data.setIn(['tail', type], tbl.data)
        })
      }
      this.data = this.data.set('deltas', new List(data.deltas || []))
      this.data = this.data.set('tailptr', data.tailptr || 0)
      this.resetIndices('tail')
      this.resetHead()
    }
  }

  resetHead() {
    this.data = this.data.set('head', this.data.get('tail'))
    for (const dlt of this.getLocalDeltas())
      this.applyDelta(dlt)
  }

  resetIndices(branch = 'head') {
    for (const tbl of this.iterTables(branch)) {
      tbl.resetIndices()
      this.saveTable(tbl, branch)
    }
  }

  equals(other) {
    return this.data.equals(other.data)
  }

  copy() {
    return new CacheDB({schema: this.schema, data: this.data})
  }

  /**
   * Clear the database in preparation for new data.
   */
  clear() {

    // Build a set of all outgoing records. We don't want to remove any
    // records that still have outgoing deltas.
    let outgoing = this.data.get('deltas')
                       .filter(x => x.isRemove())
                       .map(x => this.get(x.iid()))

    // Clear head and tail.
    this.data = this.data
                    .set('head', new Map())
                    .set('tail', new Map())

    // Re-insert the outgoing records.
    outgoing.forEach(
      rec => {
        let tbl = this.getTable(rec._type, 'tail')
        tbl.set(rec)
        this.saveTable(tbl, 'tail')
      }
    )

    // Reset head.
    this.data = this.data.set('head', this.data.get('tail'))
  }

  /**
   * Load models from JSON API format.
   */
  loadJsonApi(response) {
    response = toIterable(response)
    let splitObjectsSet = response.map(x => splitJsonApiResponse(x))
    this.loadSplitObjectsSet(splitObjectsSet)
  }

  /**
   * Load a set of objects into the DB.
   */
  loadObjects(objects) {
    objects = toIterable(objects)
    let splitObjects = {}
    for (const obj of objects) {
      if (!(obj._type in splitObjects))
        splitObjects[obj._type] = []
      splitObjects[obj._type].push(obj)
    }
    this.loadSplitObjectsSet(splitObjects)
  }

  loadSplitObjectsSet(splitObjectsSet) {
    splitObjectsSet = toIterable(splitObjectsSet)

    // Unapply my outgoing deltas to make sure we don't duplicate
    // the deltas.
    for (const dlt of this.data.get('deltas'))
      this.applyDelta(dlt, true, 'tail')

    // Load all reponse objects.
    for (const splitObjects of splitObjectsSet) {

      // Now update the head data state to reflect the new server
      // information.
      for (const type of Object.keys(splitObjects)) {

        // Skip any tables we don't have a model type for.
        let tbl = this.getTable({type, branch: 'tail', warn: true})
        if (!tbl)
          continue

        splitObjects[type].map(obj => tbl.set(obj))
        this.saveTable(tbl, 'tail')
      }
    }

    // Recalculate reverse-related fields.
    this.updateReverseRelationships('tail')

    // Replay outgoing deltas onto tail. This is to match the expectation
    // that outgoing deltas will be applied to the server.
    for (const dlt of this.getRemoteDeltas())
      this.applyDelta(dlt, false, 'tail')

    // Rebuild head.
    this.resetHead()
  }

  getLocalDeltas() {
    return this.data.get('deltas').slice(this.data.get('tailptr'))
  }

  getRemoteDeltas() {
    return this.data.get('deltas').slice(0, this.data.get('tailptr'))
  }

  // TODO
  updateReverseRelationships(branch = 'head') {
    this.clearReverseRelationships(branch)

    // Process each table in turn.
    for (const type of this.data.get(branch).keys()) {
      let tbl = this.getTable(type, branch)

      // Iterate over each field in the table's model that has
      // a related name associated with it.
      for (const [fldName, fld] of tbl.model.iterRelationships({reverse: false})) {
        const relName = fld.get('relatedName')
        if(!relName)
          continue

        // Iterate over each record in the table. Note that this
        // skips null'd records.
        for (const rec of tbl.iterRecords()) {
          for (const rel of tbl.iterRelated(rec.id, field)) {
            let relTbl = this.getTable({type: rel._type, branch, warn: true})
            const relObj = relTbl.get(rel.id)
            if (!relObj)
              continue
            if (!tbl.model.fieldIsForeignKey(relName))
              relTbl.addRelationship(rel.id, relName, this.getId(rec))
            else
              relTbl.set(relTbl.get(rel.id).set(relName, this.getId(rec)))
            this.saveTable(relTbl, branch)
          }
        }
      }
    }
  }

  // TODO
  clearReverseRelationships(branch = 'head') {
    this.data.get(branch).forEach((tblData, type) => {
      let tbl = this.getTable(type, branch)
      tbl.model.relationships.forEach((relInfo, field) => {
        if (!relInfo.get('reverse'))
          return
        tbl.data.get('objects').forEach(obj => {
          if (obj === null)
            return
          // TODO: Only worrying about many-related.
          tbl.set(obj.set(field, new OrderedSet()))
        })
      })
      this.saveTable(tbl, branch)
    })
  }

  makeIID(type, id) {
    return makeIID(type, id)
  }

  getModel(type) {
    return this.schema.getModel(type)
  }

  getTable(options) {
    const [type, opts] = argopts(options, 'type', isObject)
    const {branch = 'head'} = opts
    const data = this.data.getIn([branch, type])
    return new Table({type, data, db: this})
  }

  * iterTables(branch = 'head') {
    for (const [type, data] of this.data.get(branch))
      yield new Table({type, data, db: this})
  }

  saveTable(table, branch = 'head') {
    this.data = this.data.setIn([branch, table.type], table.data)
  }

  toObject(data) {
    return this.schema.toObject(data)
  }

  get(options) {
    let rec = this.getRecord(options)
    if (!rec) {
      // TODO: Better errors.
      throw new ModelError('Unknown record')
    }
    return this.schema.toInstance(rec, this)
  }

  exists(options) {
    return !!this.getRecord(options)
  }

  filter(type, filter, options) {
    this.getTable(type).filter(filter)
  }

  sort(results, fields) {
    // TODO: Check if sort fields exist.
    fields = toIterable(fields)
    return results.sort((a, b) => {
      for (let f of fields) {
        const d = (f[0] === '-') ? -1 : 1
        const av = this.lookup(a, f)
        const bv = this.lookup(b, f)
        if (av < bv) return -d
        if (av > bv) return d
      }
      return 0
    })
  }

  lookup(record, fields) {
    return this.getModel(record._type).lookup(record, fields)
  }

  query(options) {
    const {type, filter, sort, ...other} = options
    let results = this.filter(type, filter, other)
    if (sort)
      results = this.sort(results, sort)
    return results.then(r => r.map(x => this.toInstance(x)))
  }

  getRecord(iid) {
    let type, query
    if (Array.isArray(iid)) {
      type = iid._type
      query = {id: iid.id}
    }
    else {
      const {_type, ...other} = iid
      type = _type
      query = other
    }
    return this.getTable(type).get(query)
  }

  getDeltas() {
    return this.data.get('deltas')
  }

  getTailPointer() {
    return this.data.get('tailptr')
  }

  createInstance(type, data) {
    return this.getInstance(this.create({ _type: type, ...data }))
  }

  create2(type, data) {
    return this.create({_type: type, ...data})
  }

  create(data) {
    const model = this.getModel(data._type)
    let object = this.toObject(data)
    if (object.id === undefined)
      object = object.set('id', uuid.v4())
    const diff = model.diff(undefined, object)
    this.applyDiff(diff)
    this.data = this.data.update('diffs', x => x.push(diff))
    return object
  }

  update(full, partial) {
    let existing = this.get(full._type, full.id)
    if (existing === undefined)
      throw new ModelError('Cannot update non-existant object.')
    const model = this.getModel(existing._type)

    let updated
    if (partial !== undefined) {
      updated = existing
      for (const field of model.iterFields()) {
        if (field in partial)
          updated = updated.set(field, partial[field])
      }
    }
    else
      updated = this.toObject(full)

    // Create a diff and add to the chain.
    const diff = model.diff( existing, updated );
    if (diff) {
      this.data = this.data.update('diffs', x => x.push(diff))

      // If we wanted to keep the full diff-chain we'd add it here, but
      // for now let's just update the head.
      this.applyDiff( diff );
    }
  }

  createOrUpdate( obj ) {
    if (this.get({_type: obj._type, id: obj.id}) === undefined)
      return this.create(obj)
    else
      return this.update(obj)
  }

  /* getOrCreate( type, query ) {
     const obj = this.get( type, query );
     if( obj === undefined )
     return {_type: type, id: uuid.v4(), ...query};
     return obj;
     } */

  remove(typeOrObject, id) {
    let type
    if (id === undefined) {
      type = typeOrObject._type
      id = typeOrObject.id
    }
    else
      type = typeOrObject
    const model = this.getModel(type)
    let object = this.get(type, id)
    id = this.getId(object)
    const diff = model.diff(object, undefined)
    this.applyDiff(diff)
    this.data = this.data.update('diffs', x => x.push(diff))
  }

  applyDiff(diff, reverse = false, branch = 'head') {
    const id = getDiffId(diff)
    let tbl = this.getTable(id._type, branch)
    tbl.applyDiff(diff, reverse)
    this.saveTable(tbl, branch)
    this._applyDiffRelationships(diff, reverse, branch)
  }

  _applyDiffRelationships( diff, reverse=false, branch='head' ) {
    const ii = reverse ? 1 : 0;
    const jj = reverse ? 0 : 1;
    const id = this.getId( getDiffId( diff ) )
    const model = this.getModel( id._type );
    for( const field of model.iterFields() ) {
      if( diff[field] === undefined )
        continue;
      const relInfo = model.relationships.get( field );
      if( !relInfo )
        continue;
      const relName = relInfo.get( 'relatedName' );
      const relType = relInfo.get( 'type' );
      if( relInfo.get( 'reverse' ) || !relName || !relType )
        continue;
      let tbl = this.getTable( relType, branch );
      if( relInfo.get( 'many' ) ) {

        // M2Ms store the removals in 0 (ii), and the additions in 1 (jj).
        if( diff[field][ii] !== undefined ) {
          diff[field][ii].forEach( relId => {
            tbl.removeRelationship( relId.id, relName, id )
          });
        }
        if( diff[field][jj] !== undefined )
          diff[field][jj].forEach( relId => tbl.addRelationship( relId.id, relName, id ) )
      }
      else {

        // Don't update the reverse relationships if the value
        // hasn't changed.
        if( diff[field][ii] != diff[field][jj] ) {
          let relId = diff[field][ii]
          if( relId )
            tbl.removeRelationship( relId.id, relName, id )
          relId = diff[field][jj]
          if( relId )
            tbl.addRelationship( relId.id, relName, id )
        }
      }
      this.saveTable( tbl, branch )
    }
  }

  /**
   *
   */
  commitDiff(diff) {

    // If no diff was given, use the oldest one available.
    // If no such diff is available then return.
    if (!diff) {
      diff = this.data.getIn(['diffs', 0])
      if(!diff)
        return
    }

    // Find the model, convert data to JSON API, and send using
    // the appropriate operation.
    const type = getDiffId(diff)._type
    const model = this.getModel(type)
    if (model === undefined)
      throw new ModelError(`No model of type "${type}" found during \`commitDiff\`.`);
    const op = getDiffOp(diff)
    const data = model.diffToJsonApi(diff)

    // Check for valid operation.
    if (!model.ops || model.ops[op] === undefined)
      throw new ModelError(`No such operation, ${op}, defined for model type ${type}`)

    // Different method based on operation.
    let promise;
    if (op == 'create') {
      try {
        console.debug('CREATE: ', data)
        promise = model.ops.create(data)
      }
      catch( err ) {
        throw new ModelError(`Failed to execute create operation for type "${type}".`);
      }
    }
    else if( op == 'update' ) {
      try {
        console.debug('UPDATE: ', data)
        promise = model.ops.update(data.data.id, data)
      }
      catch( err ) {
        throw new ModelError( `Failed to execute update operation for type "${type}".` );
      }
    }
    else if( op == 'remove' ) {
      try {
        console.debug('REMOVE: ', data)
        promise = model.ops.remove(data.data.id)
      }
      catch( err ) {
        throw new ModelError( `Failed to execute remove operation for type "${type}".` );
      }
    }
    else
      throw new ModelError( `Unknown model operation: ${op}` );

    // Add on any many-to-many values.
    // TODO: This will currently spawn an unecessary POST above if there is only
    // many-to-many updates. Add a bit to the above that checks if the update is
    // empty and just creates a dummy promise.
    for (const field of model.iterManyToMany()) {
      if (field in diff) {
        promise = promise.then(response => {
          if (diff[field][1] && diff[field][1].size) {
            if(!model.ops[`${field}Add`])
              throw new ModelError( `No many-to-many add declared for ${field}.` );
            model.ops[`${field}Add`]( data.data.id, {data: diff[field][1].toJS().map( x => ({type: x._type, id: x.id}) )} );
          }
          return response;
        })
        .then(response => {
          if( diff[field][0] && diff[field][0].size ) {
            if( !model.ops[`${field}Remove`] )
              throw new ModelError( `No many-to-many remove declared for ${field}.` );
            model.ops[`${field}Remove`]( data.data.id, {data: diff[field][0].toJS().map( x => ({type: x._type, id: x.id}) )} );
          }
          return response;
        });
      }
    }

    // Note that popping the diff from the set is done in `postCommitDiff`.

    return promise;
  }

  postCommitDiff(response, diff) {
    return executionTime(() => {

      // If no diff was supplied, operate on the first in the queue,
      // including unshifting it and updating the tail pointer.
      if (!diff) {
        diff = this.data.getIn(['diffs', 0])
        this.data = this.data.update('diffs', x => x.shift())
        this.data = this.data.update('tailptr', x => x -= 1)
      }

      // If we've created an object, perform a reId.
      if (getDiffOp(diff) == 'create') {
        const {data} = response
        const id = toArray(data)[0].id
        this.reId(diff._type[1], diff.id[1], id)
        return true
      }

      return false
    }, 'postCommitDiff')
  }

  /**
   * Change the ID of an object.
   *
   * This is actually a great big jerk. We need to lookup all references
   * to this object across *everything* and change the identifier.
   *
   * NOTE: We can't remove the old ID straight away, as there are cases
   *       where other components still need to reference it.
   */
  reId(type, id, newId, branch) {
    console.debug(`DB: reId: New ID for ${type}, ${id}: ${newId}`)

    // If no branch was given, do both.
    if( branch === undefined )
      branch = ['head', 'tail']
    else
      branch = [branch]

    // Perform the reId on both branches.
    for (const br of branch) {
      console.debug('Looking at branch: ', br)

      // Update the ID of the object itself.
      let tbl = this.getTable(type, br)
      tbl.reId(id, newId)
      this.saveTable(tbl, br)

      // Now update the relationships.
      console.debug('Updating relationships.')
      const model = this.getModel(type)
      const fromId = this.makeId(type, id)
      const toId = this.makeId(type, newId)
      tbl.forEachRelatedObject(newId, (objId, reverseField) => {
        if (!reverseField)
          return
        console.debug('Looking at related object with "id" "reverse field": ', objId.toJS(), reverseField)
        const obj = this.get(objId)
        const relTbl = this.getTable(obj._type, br)
        const relModel = relTbl.model
        if (!relModel.fieldIsForeignKey(reverseField)) {
          relTbl.removeRelationship(obj.id, reverseField, fromId)
          relTbl.addRelationship(obj.id, reverseField, toId)
        }
        else
          relTbl.set( obj.set( reverseField, toId ) );
        this.saveTable( relTbl, br );
      });

      // Finally, update any references in diffs.
      // TODO: This is slow and shit.
      const diffs = this.data.getIn( ['diffs'] );
      for( let ii = 0; ii < diffs.size; ++ii ) {
        const diff = diffs.get( ii );
        let newDiff = {
          id: [diff.id[0], diff.id[1]]
        };
        let changed = false;
        if( diff.id[0] == id ) {
          newDiff.id[0] = newId;
          changed = true;
        }
        if( diff.id[1] == id ) {
          newDiff.id[1] = newId;
          changed = true;
        }
        const relModel = this.getModel( getDiffId( diff )._type )
        for( const field of relModel.iterForeignKeys() ) {
          if( diff[field] ) {
            newDiff[field] = [diff[field][0], diff[field][1]]
            if(diff[field][0] && fromId.equals(this.getId(diff[field][0]))) {
              newDiff[field][0] = toId
              changed = true
            }
            if(diff[field][1] && fromId.equals(this.getId(diff[field][1]))) {
              newDiff[field][1] = toId
              changed = true
            }
          }
        }
        for( const field of relModel.iterManyToMany() ) {
          if( diff[field] ) {
            newDiff[field] = [diff[field][0], diff[field][1]];
            if( newDiff[field][0] && newDiff[field][0].has( fromId ) ) {
              newDiff[field][0] = newDiff[field][0].delete( fromId ).add( toId );
              changed = true;
            }
            if( newDiff[field][1] && newDiff[field][1].has( fromId ) ) {
              newDiff[field][1] = newDiff[field][1].delete( fromId ).add( toId );
              changed = true;
            }
          }
        }
        if( changed )
          this.data = this.data.updateIn( ['diffs', ii], x => Object( {...x, ...newDiff} ) );
      }
    }
  }

  saveJson(filename) {
    saveJson(this.data.toJS(), filename)
  }

  loadJson(file) {
    return loadJson(file).then(r => {
      this.reset(r)
      this.updateReverseRelationships('head')
      this.updateReverseRelationships('tail')
    })
  }

}
