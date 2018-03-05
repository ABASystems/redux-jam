import { List, Map, Set, Record } from 'immutable'

export function isIterable( x ) {
  if( x === null )
    return false
  return typeof x[Symbol.iterator] === 'function'
}

export function isObject( x ) {
  return typeof x === 'object' && x !== null
}

export function isEmpty( x ) {
  return x === undefined || x === null
}

export function toArray( x ) {
  if( x instanceof Array )
    return x
  return [x]
}

export function isRecord( x ) {
  return isObject( x ) && x._map !== undefined
}

export function toList( x ) {
  if( x instanceof Array )
    return new List( x )
  if( List.isList( x ) )
    return x
  return new List([ x ])
}

export class ModelError extends Error {
  constructor( ...args ) {
    super( ...args )
    this.name = this.constructor.name
    try {
      Error.captureStackTrace( this, this.constructor )
    }
    catch( e ) {
    }
  }
}

export class ModelDoesNotExist extends ModelError {
}

export class ModelTooManyResults extends ModelError {
}

export class Rollback extends ModelError {
}

export const ID = Record({
  _type: undefined,
  id: undefined
})

export function makeId( typeOrObj, id ) {
  if( id === undefined )
    return new ID( {_type: typeOrObj._type, id: typeOrObj.id} )
  else
    return new ID( {_type: typeOrObj, id} )
}

export function getDiffId( diff ) {
  return makeId(
    diff._type[0] || diff._type[1],
    (diff.id[0] !== undefined) ? diff.id[0] : diff.id[1]
  )
}

export function getDiffOp( diff ) {
  if( diff._type[0] === undefined )
    return 'create'
  else if( diff._type[1] === undefined )
    return 'remove'
  else
    return 'update'
}

/**
 *
 */
export function toIndexMap( objects, key='id' ) {
  let index = new Map()
  if( !isEmpty( objects ) ) {
    objects.forEach( (item, ii) => {
      const val = item[key]
      if( !index.has( val ) )
        index = index.set( val, new Set([ ii ]) )
      else
        index = index.updateIn([ val ], x => x.add( ii ))
    })
  }
  return index
}

/**
 * Calculate overlapping indices based on a key/value lookup.
 */
function reduceIndices( results, indices, key, value ) {
  const index = indices.get( key )
  if( index === undefined )
    throw new ModelError( `Index not found: ${key}` )
  const other = index.get( value )
  if( other === undefined )
    return new Set()
  if( results === undefined )
    return other
  return results.intersect( other )
}

/**
 * Filter objects based on a query.
 */
export function filterObjects( collection, idOrQuery, idKey='id' ) {
  if( !collection )
    return
  const { alias, objects, indices } = collection
  if( !isObject( idOrQuery ) )
    idOrQuery = { [idKey]: idOrQuery }
  let results
  for( const key in idOrQuery ) {
    let id = idOrQuery[key]
    if( key == idKey && alias.has( id ) )
      id = alias.get( id )
    results = reduceIndices( results, indices, key, id )
  }
  return results.map( ii => collection.objects.get( ii ))
}

/**
 * Get a single object matching the query.
 */
export function getObject( collection, idOrQuery, error=true, key='id' ) {
  const obj = filterObjects( collection, idOrQuery, key )
  if( obj === undefined || obj.size == 0 ) {
    if( error ) {
      throw new ModelDoesNotExist()
    }
    return
  }
  if( obj.size > 1 ) {
    throw new ModelTooManyResults()
  }
  return obj.first()
}

/**
 * Initialise a model collection.
 */
export function initCollection( data, indices='id' ) {
  let inds = new Map()
  for( const key of toArray( indices ) )
    inds = inds.set( key, toIndexMap( data, key ) )
  return {
    objects: new List( data || [] ),
    indices: inds,
    alias: new Map()
  }
}

/**
 * Eliminate the object's index from current indices.
 */
function removeIndex( indices, object, key='id' ) {
  const { id } = object
  const index = indices.getIn( [key, id] ).first()
  for( const field of indices.keys() ) {
    if( field == key )
      continue
    const value = object[field]
    indices = indices.updateIn( [field, value], x => x.delete( index ) )

    // Remove the index if it's now empty.
    if( indices.getIn( [field, value] ).size == 0 )
      indices = indices.deleteIn( [field, value] )
  }
  return indices
}

/**
 * Update a model collection. Takes care to update the indices
 * appropriately. Note that this only adds new models and updates
 * existing ones.
 */
export function updateCollection( collection, data, key='id', _indices ) {

  // If we get given an empty collection, just initialise.
  if( collection === undefined )
    return initCollection( toArray( data ), _indices )

  let { indices, objects } = collection
  toArray( data ).forEach( obj => {

    // Do we already have this object?
    const id = obj[key]
    const query = { [key]: id }
    const existing = getObject( collection, query, false )  // don't error

    // If the object doesn't exist, just add it on to the end.
    if( existing === undefined ) {
      objects = objects.push( obj )
      indices = indices.setIn( [key, id], new Set( [objects.size - 1] ) )
    }
    else {

      // Eliminate the object's index from current indices.
      const index = indices.getIn( [key, id] ).first()
      indices = removeIndex( indices, existing, key )

      // Merge new values.
      objects = objects.updateIn( [index], x => Object( {...x, ...obj} ) )
    }

    // Add indices.
    const index = indices.getIn( [key, id] ).first()
    for( const field of indices.keys() ) {
      if( field == key )
        continue
      const value = obj[field]
      indices = indices.updateIn( [field, value], x => {
        return (x === undefined) ? new Set( [index] ) : x.add( index )
      })
    }
  })
  return {
    ...collection,
    objects,
    indices
  }
}

/**
 * Remove one or more objects from a collection.
 *
 * TODO: At the moment this will leave dangling aliases.
 */
export function removeFromCollection( collection, ids, key='id' ) {
  let { objects, indices, alias } = collection
  toArray( ids ).forEach( id => {
    if( alias.has( id ) ) {
      let newId = alias.get( id )
      alias = alias.delete( id )
      id = newId
    }
    const index = indices.getIn( [key, id] ).first()
    indices = removeIndex( indices, objects.get( index ) )
    indices = indices.deleteIn( [key, id] )
    objects = objects.set( index, {} )
  })
  return {
    objects,
    indices,
    alias
  }
}

/**
 * Assign a new ID to an object, adding an alias for the old ID.
 */
export function aliasIdInCollection( collection, oldId, newId, key='id' ) {
  if( !collection )
    return

  // If the old ID can't be found then don't do anything.
  // Why would this happen?
  let { objects, indices, alias } = collection
  if( !indices.hasIn( [key, oldId] ) )
    return collection

  // Update the ID index to point to use the new ID, removing
  // the old ID.
  const index = indices.getIn( [key, oldId] ).first()
  indices = indices.deleteIn( [key, oldId] )
  indices = indices.setIn( [key, newId], new Set( [index] ) )

  // Update the ID in the object.
  objects = objects.update( index, x => Object( {...x, id: newId} ) )

  // Add the alias.
  alias = alias.set( oldId, newId )

  return {objects, indices, alias}
}


/**
 * Flatten JSON API object.
 */
export function flattenObject( object ) {
  let objects = toArray( object ).map( x => {
    let obj = {
      _type: x.type,
      id: x.id,
      ...(x.attributes || {})
    }
    const rels = x.relationships || {}
    if( rels ) {
      Object.keys( rels ).forEach( x => {
        const relsData = rels[x].data
        if( !relsData )
          return
        obj[x] = toArray( relsData ).map( y => Object( {id: y.id, _type: y.type} ) )
        if( !Array.isArray( relsData ) )
          obj[x] = obj[x][0]
        else
          obj[x] = new Set( obj[x] )
      })
    }
    return obj
  })
  return Array.isArray( object ) ? objects : objects[0]
}

/**
 * Split array of JSON API objects.
 */
export function splitObjects( objects=[], data={} ) {
  if( objects === null )
    return {}
  toArray( objects ).forEach( obj => {
    const { type } = obj
    if( !(type in data) )
      data[type] = []
    data[type].push( flattenObject( obj ) )
  })
  return data
}

/**
 * Split JSON API response.
 */
export function splitJsonApiResponse( response ) {
  let data = splitObjects( response.data )
  return splitObjects( response.included, data )
}

/**
 * Resolve a relationship.
 */
/* function collectRelationships( splitResponse, relationships, cache = {} ) {
 *   let results = []
 *   toArray( relationships ).forEach( rel => {
 * 
 *     // Relationships can be null, meaning they're a foreignkey
 *     // and there's no value.
 *     if( rel === null )
 *       return null
 * 
 *     let res = (splitResponse[rel.type] || {})[rel.id]
 *     if( res !== undefined )
 *       res = _collectJsonApi( splitResponse, res, cache )
 *     else
 *       res = rel.id
 *     results.push( res )
 *   })
 *   if( relation instanceof Array )
 *     return results
 *   return results[0]
 * }*/

/**
 * Collect model relationships.
 */
/* function _collectJsonApi( splitModels, models, cache = {} ) {
 *   let results = toArray( models ).map( mod => {
 * 
 *     // Check if the object exists in our cache.
 *     const type = mod.type
 *     if( type in cache && mod.id in cache[type] )
 *       return cache[type][mod.id]
 * 
 *     // Build the object and insert into cache.
 *     let obj = {
 *       id: mod.id,
 *       _type: type,
 *       ...mod.attributes
 *     }
 *     if( !(type in cache) )
 *       cache[type] = {}
 *     cache[type][obj.id] = obj
 * 
 *     // Build relationships.
 *     const {relationships = {}} = mod
 *     for( const key of Object.keys( relationships ) ) {
 *       obj[key] = collectRelationships( splitModels, relationships[key], cache )
 *       return obj
 *     })
 *     if( models instanceof Array )
 *       return results
 *     return results[0]
 *   }
 * }*/

export function collectJsonApi( response ) {
  const splitModels = splitJsonApiResponse( response )
  let map = {}
  Object.keys( splitModels ).map( type => {
    map[type] = toIndexMap( splitModels[type] )
  })

  function _doObject( obj ) {
    if( map[obj.type] === undefined || map[obj.type].get( obj.id ) == undefined )
      return {_type: obj.type, id: obj.id}
    let idx = map[obj.type].get( obj.id )
    let mod = splitModels[obj.type][idx.first()]
    Object.keys( obj.relationships || {} ).map( relName => {
      let rels = obj.relationships[relName].data
      let relMods = toArray( rels || [] ).map( relObj => {
        return _doObject( relObj )
      })
      relMods = relMods.filter( x => x !== undefined )
      if( !Array.isArray( rels ) )
        relMods = relMods[0]
      mod[relName] = relMods
    })
    return mod
  }

  let models = toArray( response.data ).map( obj => {
    return _doObject( obj )
  })
  if( !Array.isArray( response.data ) )
    models = models[0]
  return models
}
