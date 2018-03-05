import { Map } from 'immutable'
import uuid from 'uuid'

import {
  isEmpty,
  toArray,
  cmpIds,
  toList,
  ModelError
} from './utils'

/**
 * A convenience class to represent model data.
 *
 * Provides getters/setters to assist in modifying model data locally,
 * then saving to the DB later. Also wraps relationships to make
 * finding local DB instances easier.
 */
export default class Instance {

  constructor( data, model, db ) {
    if( isEmpty( model ) ) {
      throw new ModelError( 'Instance: No model given.' )
    }
    if( isEmpty( db ) ) {
      throw new ModelError( 'Instance: No DB given.' )
    }
    this.id = data.get( 'id' ) || uuid.v4()
    this._db = db
    this._model = model
    this._type = model.type
    this._initial = data
    this._prepareAttributes( data )
    this._prepareRelationships( data )
    this._values = this._initial
  }

  /**
   * Add model attributes to the instance.
   */
  _prepareAttributes( data ) {
    for( const name of this._model.attributes.keys() ) {
      const attr = this._model.attributes.get( name )
      if( data[name] !== undefined ) {
        this._initial = this._initial.set( name, data[name] )
      }
      Object.defineProperty( this, name, {
        get: function() {
          return this._values.get( name )
        },
        set: function( x ) {
          this._values = this._values.set( name, x )
        }
      })
    }
  }

  /**
   * Add model relationships to the instance.
   */
  _prepareRelationships( data ) {
    for( const name of this._model.relationships.keys() ) {
      const rel = this._model.relationships.get( name )
      if( rel.get( 'many' ) ) {
        this._initial = this._initial.set( name, data[name] )
        Object.defineProperty( this, name, {
          get: function() {
            return {
              all: () => {
                return this._values.get( name ).map( x =>
                  this._db.getInstance( x )
                )
              },
              add: x => {
                this._values = this._values.updateIn( [name], y =>
                  y.add( this._db.getId( x ) )
                )
              },
              remove: x => {
                this._values = this._values.updateIn( [name], y =>
                  y.remove( this._db.getId( x ) )
                )
              }
            }
          },
          set: function( x ) {
            throw ModelError( 'Cannot directly set many-to-many.' )
          }
        })
      }
      else {

        // Set the initial value if it exists.
        if( data[name] !== undefined ) {
          this._initial = this._initial.set( name, data[name] )
        }

        // The getter for foriegn-keys will return an Instance object
        // if one exists, and undefined otherwise.
        Object.defineProperty( this, name, {
          get: function() {

            // TODO: Use db.get once I've converted it.
            let obj = this._db.get( this._values.get( name ) )
            if( obj ) {
              obj = this._db.schema.toInstance( obj, this._db )
            }
            return obj
          },
          set: function( x ) {
            if( x ) {
              this._values = this._values.set( name, this._db.getId( x ) )
            }
            else {
              this._values = this._values.set( name, x )
            }
          }
        })
      }
    }
  }

  save() {
    this._db.createOrUpdate( this._values )
  }

  delete() {
    this._db.remove( this._values )
  }

  reset() {
    this._values = this._initial
  }

  getDB() {
    return this._db
  }

  getModel() {
    return this._model
  }

}
