import { List, Map, Set, fromJS, Record } from 'immutable'

import { Filter, DBVisitor } from './filter'
import { ModelError, getDiffId, ID, isEmpty, isObject, isRecord } from './utils'

/**
 * Represents data of a particular type.
 */
export default class Table {

  static filterRegex = /^([a-zA-Z](?:_?[a-zA-Z0-9])+)__([a-zA-Z](?:_?[a-zA-Z0-9])+)$/

  /**
   * `data` can be one of: a list of objects, a pre-constructed immutable
   * map containing table data, or undefined.
   *
   * TODO: This is a bit inefficient given how often it will be called.
   */
  constructor( type, options = {} ) {
    let { data, db, idField = 'id', indices } = options
    this.type = type
    this.db = db
    this.model = db.getModel( type, true )
    this.idField = idField

    // Figure out what my indices are.
    this.indices = new Set( indices || this.model.indices || ['id'] )
    if( !this.indices.has( idField ) )
      throw new ModelError( `idField: ${idField} not found in indices: ${indices}` )

    if( data ) {
      if( Array.isArray( data ) ) {
        this.data = new Map({
          objects: db.toObjects( new List( data ) ),
          indices: new Map( this.indices.toJS().map( x =>
            [x, new Map( this._toIndexMap( data, x ) )] )
          )
        })
      }
      else if( Map.isMap( data ) )
        this.data = data
      else {
        this.data = new Map({
          objects: db.toObjects( new List( data.objects ) ),
          indices: fromJS( data.indices )
        })
      }
    }
    else
      this.reset()
  }

  reset() {
    this.data = new Map({
      objects: new List(),
      indices: new Map( this.indices.toJS().map( x => [x, new Map()] ) )
    })
  }

  _toIndexMap( objects, key='id' ) {
    let index = new Map()
    if( !isEmpty( objects ) ) {
      objects.forEach( (item, ii) => {
        const val = this._valueToIndexable( key, item[key] )
        if( !index.has( val ) )
          index = index.set( val, new Set([ ii ]) )
        else
          index = index.updateIn([ val ], x => x.add( ii ))
      })
    }
    return index
  }

  /**
   * Get a single object matching the query.
   */
  get( idOrQuery ) {
    const objects = this.filter( idOrQuery );
    if( !objects.size )
      return;
    if( objects.size > 1 )
      throw new ModelError( 'Too many objects returned in table.' );
    return objects.first();
  }

  /**
   * Filter objects based on a query.
   */
  filter( idOrQuery ) {
    if( Filter.isFilter( idOrQuery ) ) {
      let visitor = new DBVisitor( this.db, this.type )
      return visitor.execute( idOrQuery )
    }
    else if( !idOrQuery )
      return this.data.get( 'objects' ).valueSeq().toArray()
    else
      return this._mapIndices( this._filterIndices( idOrQuery ) )
  }

  _mapIndices( indices ) {
    return indices.map( ii => this.data.getIn( ['objects', ii] ) )
  }

  /**
   * Filter objects based on a query, returning the indices.
   */
  _filterIndices( idOrQuery ) {
    if( !isObject( idOrQuery ) ) {
      idOrQuery = { [this.idField]: idOrQuery }
    }
    let results
    for( const field in idOrQuery ) {
      let value = idOrQuery[field]

      // What kind of query are we looking at? If there's a double
      // underscore somewhere it's something more fancy.
      let match = field.match( Table.filterRegex )
      if( match !== null ) {
        switch( match[2].toLowerCase() ) {

            // TODO: Sooo much optimisation here. These filters should be easy to
            //  write and much more efficient.

          // Lookup based on a string containing a value.
          case 'contains':
            results = this._reduceIndices( results, () =>
              // TODO: This is a bit annoying, having to conver to a Set.
              // TODO: Also, what about data types? Should fail nicely if no 'includes'
              new Set( this.data
                           .get( 'objects' )
                           .map( (v, k) => v.get( match[1] ).includes( value ) ? k : undefined ) // TODO: Check if field exists.
                           .filter( v => v !== undefined ) )
            )
            break

          case 'isnull':
            results = this._reduceIndices( results, () =>
              // TODO: This is a bit annoying, having to conver to a Set.
              new Set( this.data
                           .get( 'objects' )
                           .map( (v, k) => {
                             // TODO: Better manage types.
                             if( this.model.fieldIsManyToMany( match[1] ) )
                               return v.get( match[1] ).size == 0 ? k : undefined
                             else
                               return v.get( match[1] ) == null ? k : undefined // TODO: Check if field exists.
                           })
                           .filter( v => v !== undefined ) )
            )
            break

          case 'in':
            value = this.db.makeId( value )
            results = this._reduceIndices( results, () =>
              // TODO: This is a bit annoying, having to conver to a Set.
              new Set( this.data
                           .get( 'objects' )
                           .map( (v, k) => v.get( match[1] ).has( value ) ? k : undefined )
                           .filter( v => v !== undefined ) )
            )
            break

          default:
            throw new ModelError( `Unknown filter: ${match[2]}` )
        }
      }

      // No double slash means we can perform an exact lookup. Currently
      // this only works for fields with an index.
      else {
        results = this._reduceIndices( results, () => {
          const index = this.data.getIn( ['indices', field] )
          if( index === undefined ) {
            console.warn( `Table index not found for type "${field}", will be inefficient.` )
            /* throw new ModelError( `Table index not found: ${field}` )*/
            // TODO: This is a bit annoying, having to conver to a Set.
            return new Set( this.data
                                .get( 'objects' )
                                .map( (v, k) => (v.get( field ) == value) ? k : null )
                                .filter( v => v !== null ) )
          }
          else {
            return index.get( this._valueToIndexable( field, value ) )
          }
        })
      }
    }
    return results
  }

  /**
   * Calculate overlapping indices based on a field/value lookup.
   */
  _reduceIndices( indices, getOtherIndices ) {
    const other = getOtherIndices()
    /* const index = this.data.getIn( ['indices', field] )
     * if( index === undefined ) {
     *   throw new ModelError( `Table index not found: ${field}` )
     * }
     * const other = index.get( this._valueToIndexable( field, value ) )*/
    if( other === undefined ) {
      return new Set()
    }
    if( indices === undefined ) {
      return other
    }
    return indices.intersect( other )
  }

  set( object ) {

    // TODO: Must be a better way to convert to a record...
    try {
      object.get( 'id' );
    }
    catch( e ) {
      object = this.db.toObject( object );
    }

    // If the object doesn't exist, just add it on to the end. Don't
    // worry about adding all the indices, we'll put them in at the
    // end.
    const id = object[this.idField];
    if( id === undefined ) {
      throw ModelError( 'No ID given for table set.' );
    }
    const existing = this.get( {[this.idField]: id} );
    if( !existing ) {
      const size = this.data.get( 'objects' ).size;
      this.data = this.data
                      .update( 'objects', x => x.push( object ) )
                      .setIn( ['indices', this.idField, id], new Set( [size] ) );
    }
    else {

      // Don't stomp on the existing object's ID. After a reID has been run
      // we keep around the old ID reference. Occasionally, an object may be
      // updated using the old ID, so we need to ensure we don't stomp it.
      object = object.set( 'id', existing.id )

      // Eliminate the object's index from current indices and set the
      // new object.
      const index = this._getIndex( id );
      this._removeFromIndices( existing );
      this.data = this.data.setIn( ['objects', index], object );
    }

    // Add indices.
    const index = this._getIndex( id );
    this.data.get( 'indices' ).forEach( (ii, field) => {
      if( field == this.idField )
        return;
      const value = this._valueToIndexable( field, object.get( field ) );
      this.data = this.data.updateIn( ['indices', field, value], x => {
        return (x === undefined) ? new Set( [index] ) : x.add( index );
      });
    });
  }

  _valueToIndexable( field, value ) {
    if( this.model.fieldIsForeignKey( field ) ) {
      if( value !== undefined && value !== null )
        return value._type + '-' + value.id
    }
    return value
  }

  _getIndex( id ) {
    let index = this.data.getIn( ['indices', this.idField, id] )
    if( index === undefined )
      throw new ModelError( `Unknown ID in index lookup: ${id}` )
    return index.first()
  }

  /**
   * Eliminate the object's index from current indices.
   */
  _removeFromIndices( object ) {
    const id = object.get( this.idField );
    const index = this._getIndex( id );
    this.data.get( 'indices' ).forEach( (ii, field) => {
      if( field == this.idField )
        return;
      const value = this._valueToIndexable( field, object.get( field ) );

      // Remove the object's ID from the index.
      this.data = this.data.updateIn( ['indices', field, value], x => x.delete( index ) );

      // Remove the index if it's now empty.
      if( this.data.getIn( ['indices', field, value] ).size == 0 )
        this.data = this.data.deleteIn( ['indices', field, value] );
    });
  }

  remove( idOrQuery ) {
    const obj = this.get( idOrQuery );
    if( !obj )
      return;
    const id = obj.get( 'id' );
    const index = this._getIndex( id );

    // Remove from extra indices and also the ID index.
    this._removeFromIndices( obj );
    this.data = this.data.deleteIn( ['indices', this.idField, id] );

    // Can't remove the object or I ruin the indices.
    // TODO: Fix this.
    this.data = this.data.setIn( ['objects', index], null );
  }

  reId( oldId, newId ) {
    const index = this._getIndex( oldId );
    this.data = this.data
    /* .deleteIn( ['indices', this.idField, oldId] )*/
                    .setIn( ['indices', this.idField, newId], new Set( [index] ) )
                    .setIn( ['objects', index, this.idField], newId );
  }

  /**
   * Call a function for each related object.
   * TODO: Should use "iterRelated"?
   */
  forEachRelatedObject( id, callback ) {
    const obj = this.get( id );
    const model = this.model;
    for( const field of model.iterForeignKeys( {includeReverse: true} ) ) {
      const relName = model.relationships.getIn( [field, 'relatedName'] );
      if( obj[field] )
        callback( obj[field], relName );
    }
    for( const field of model.iterManyToMany( {includeReverse: true} ) ) {
      const relName = model.relationships.getIn( [field, 'relatedName'] );
      for( const rel of obj[field] )
        callback( rel, relName );
    }
  }

  addRelationship( id, field, relatedId ) {
    const index = this._getIndex( id );
    this.data = this.data.updateIn( ['objects', index, field], x => x.add( relatedId ) )
  }

  removeRelationship( id, field, relatedId ) {
    const index = this._getIndex( id );
    this.data = this.data.updateIn( ['objects', index, field], x => x.delete( relatedId ) )
  }

  /**
   * Iterate over all objects in table.
   */
  *iterObjects() {
    for( const obj of this.data.get( 'objects' ) ) {

      // Need to check if empty due to the way deletes work (they
      // temporarily store an empty entry in the table).
      if( !isEmpty( obj ) ) {
        yield obj
      }
    }
  }

  /**
   * Iterate over related object(s) for object's field.
   */
  *iterRelated( id, field ) {
    const obj = this.get( id )
    if( obj ) {
      const many = this.model.relationships.getIn( [field, 'many'] )
      if( many ) {
        for( const rel of obj[field] ) {
          yield rel
        }
      }
      else if( obj[field] ) {
        yield obj[field]
      }
    }
  }

  applyDiff( diff, reverse = false ) {
    const ii = reverse ? 1 : 0
    const jj = reverse ? 0 : 1
    const id = getDiffId( diff )
    let obj = this.get( id.id )

    // Creation.
    if( diff._type[ii] === undefined ) {
      if( obj !== undefined )
        throw ModelError( 'Trying to create an object that already exists.' )
      let newObj = {}
      Object.keys( diff ).forEach( x => newObj[x] = diff[x][jj] )
      this.set( this.db.toObject( newObj ) )
    }

    // Removal.
    else if( diff._type[jj] === undefined ) {
      if( obj === undefined )
        throw new ModelError( 'Trying to remove an object that doesn\'t exist.' )
      this.remove( diff.id[ii] )
    }

    // Update.
    else {
      if( obj === undefined )
        throw ModelError( 'Trying to update an object that doesn\'t exist.' )
      Object.keys( diff ).forEach( x => {
        const relInfo = this.model.relationships.get( x )
        if( relInfo && relInfo.get( 'many' ) ) {
          diff[x][ii].forEach( y => {
            if( !obj[x].has( y ) )
              throw new ModelError( 'Conflict while applying diff.' )
            obj = obj.set( x, obj[x].delete( ID( y ) ) )
          })
          diff[x][jj].forEach( y => obj = obj.set( x, obj[x].add( ID( y ) ) ) )
        }
        else {
          if( obj[x] != diff[x][ii] ) {
            debugger
            throw new ModelError( 'Conflict while applying diff.' )
          }
          obj = obj.set( x, diff[x][jj] )
        }
      })
      this.set( this.db.toObject( obj ) )
    }
  }
}
