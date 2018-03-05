require( 'isomorphic-fetch' );
var assert = require( 'chai' ).assert;
import { expect } from 'code'
import { Set } from 'immutable';

import { toIndexMap, initCollection, updateCollection, filterObjects,
         removeFromCollection, getObject, splitJsonApiResponse,
         aliasIdInCollection } from '../src/utils';
import { ModelDoesNotExist, ModelTooManyResults } from '../src/utils';

console.debug = () => {};

const fixture = [{
  id: 1,
  type: 'Author',
  name: 'Frank'
}, {
  id: 3,
  type: 'Author',
  name: 'Harry'
}, {
  id: 5,
  type: 'Author',
  name: 'Harry'
}];

describe( 'toIndexMap', function() {

  it( 'works with integer IDs (non-overlapping)', function() {
    let map = toIndexMap([ { id: 1 }, { id: 3 }, { id: 5 } ]);
    assert.deepEqual( map.toJS(), { 1: [ 0 ], 3: [ 1 ], 5: [ 2 ] });
  });

  it( 'works with integer IDs (overlapping)', function() {
    let map = toIndexMap([ { id: 1 }, { id: 3 }, { id: 5 }, { id: 3 } ]);
    assert.deepEqual( map.toJS(), { 1: [ 0 ], 3: [ 1, 3 ], 5: [ 2 ] });
  });
});

describe( 'initCollection', function() {

  it( 'works with mixed indices', function() {
    let coll = initCollection( fixture, [ 'id', 'name' ]);
    assert.deepEqual( coll.objects.toJS(), fixture );
    assert.deepEqual( coll.indices.get( 'id' ).toJS(), { 1: [ 0 ], 3: [ 1 ], 5: [ 2 ]});
    assert.deepEqual( coll.indices.get( 'name' ).toJS(), { Frank: [ 0 ], Harry: [ 1, 2 ]});
  });
});

describe( 'filterObjects', function() {
  let coll = initCollection( fixture, [ 'id', 'name' ]);

  it( 'works with ID', function() {
    assert.deepEqual( filterObjects( coll, 1 ).toJS(), [ fixture[0] ]);
    assert.deepEqual( filterObjects( coll, 5 ).toJS(), [ fixture[2] ]);
  });

  it( 'works with name', function() {
    assert.deepEqual( filterObjects( coll, { name: 'Frank' }).toJS(), [ fixture[0] ]);
    assert.deepEqual( filterObjects( coll, { name: 'Harry' }).toJS(), [ fixture[1], fixture[2] ]);
  });

  it( 'works with alias', function() {
    assert.deepEqual( filterObjects( coll, { id: 'hello' }).toJS(), [] );
    coll.alias = coll.alias.set( 'hello', 5 );
    assert.deepEqual( filterObjects( coll, { id: 1 }).toJS(), [ fixture[0] ]);
    assert.deepEqual( filterObjects( coll, { id: 'hello' }).toJS(), [ fixture[2] ]);
    assert.deepEqual( filterObjects( coll, { id: 5 }).toJS(), [ fixture[2] ]);
  });
});

describe( 'getObject', function() {
  let coll = initCollection( fixture, [ 'id', 'name' ]);

  it( 'gets a single object', function() {
    assert.deepEqual( getObject( coll, 1 ), fixture[0]);
    assert.deepEqual( getObject( coll, { name: 'Frank' }), fixture[0]);
  });

  it( 'fails when more than one object', function() {
    expect( () => getObject( coll, {name: 'Harry'} ) ).to.throw( ModelTooManyResults )
  });

  it( 'fails when no object', function() {
    assert.throws( () => getObject( coll, { name: 'Joe' }), ModelDoesNotExist );
  });
});

describe( 'updateCollection', function() {

  it( 'initialises new collection if empty', function() {
    let coll = updateCollection( undefined, fixture );
    assert.deepEqual( getObject( coll, 1 ), fixture[0]);
  });

  it( 'adds new object', function() {
    let coll = initCollection( fixture, ['id', 'name']);
    const joe = {id: 10, type: 'Author', name: 'Joe'};
    coll = updateCollection( coll, joe );
    assert.deepEqual( getObject( coll, 1 ), fixture[0] );
    assert.deepEqual( getObject( coll, 3 ), fixture[1] );
    assert.deepEqual( getObject( coll, 5 ), fixture[2] );
    assert.deepEqual( getObject( coll, 10 ), joe );
    assert.deepEqual( coll.indices.getIn( ['name', 'Joe'] ).toJS(), [3] );
  });

  it( 'adds many new objects', function() {
    let coll = initCollection( fixture, ['id', 'name']);
    const joe = {id: 10, type: 'Author', name: 'Joe'};
    const bill = {id: 20, type: 'Author', name: 'Bill'};
    const joe2 = {id: 30, type: 'Author', name: 'Joe'};
    coll = updateCollection( coll, [joe, bill, joe2] );
    assert.deepEqual( getObject( coll, 1 ), fixture[0] );
    assert.deepEqual( getObject( coll, 3 ), fixture[1] );
    assert.deepEqual( getObject( coll, 5 ), fixture[2] );
    assert.deepEqual( getObject( coll, 10 ), joe );
    assert.deepEqual( getObject( coll, 20 ), bill );
    assert.deepEqual( getObject( coll, 30 ), joe2 );
    assert.deepEqual( coll.indices.getIn( ['name', 'Joe'] ).toJS(), [3, 5] );
    assert.deepEqual( coll.indices.getIn( ['name', 'Bill'] ).toJS(), [4] );
  });

  it( 'updates existing object', function() {
    let coll = initCollection( fixture, ['id', 'name']);
    const joe = {id: 3, type: 'Author', name: 'Joe'};
    coll = updateCollection( coll, joe );
    assert.deepEqual( getObject( coll, 1 ), fixture[0] );
    assert.deepEqual( getObject( coll, 3 ), joe );
    assert.deepEqual( getObject( coll, 5 ), fixture[2] );
    assert.deepEqual( coll.indices.getIn( ['name', 'Joe'] ).toJS(), [1] );
    assert.deepEqual( coll.indices.getIn( ['name', 'Harry'] ).toJS(), [2] );
  });

  it( 'updates many existing objects', function() {
    let coll = initCollection( fixture, ['id', 'name']);
    const joe = {id: 3, type: 'Author', name: 'Joe'};
    const bill = {id: 5, type: 'Author', name: 'Bill'};
    coll = updateCollection( coll, [joe, bill] );
    assert.deepEqual( getObject( coll, 1 ), fixture[0] );
    assert.deepEqual( getObject( coll, 3 ), joe );
    assert.deepEqual( getObject( coll, 5 ), bill );
    assert.deepEqual( coll.indices.getIn( ['name', 'Joe'] ).toJS(), [1] );
    assert.deepEqual( coll.indices.getIn( ['name', 'Harry'] ), undefined );
    assert.deepEqual( coll.indices.getIn( ['name', 'Bill'] ).toJS(), [2] );
  });

  it( 'adds and updates objects', function() {
    let coll = initCollection( fixture, ['id', 'name']);
    const joe = {id: 3, type: 'Author', name: 'Joe'};
    const bill = {id: 10, type: 'Author', name: 'Bill'};
    coll = updateCollection( coll, [joe, bill] );
    assert.deepEqual( getObject( coll, 1 ), fixture[0] );
    assert.deepEqual( getObject( coll, 3 ), joe );
    assert.deepEqual( getObject( coll, 5 ), fixture[2] );
    assert.deepEqual( getObject( coll, 10 ), bill );
    assert.deepEqual( coll.indices.getIn( ['name', 'Joe'] ).toJS(), [1] );
    assert.deepEqual( coll.indices.getIn( ['name', 'Harry'] ).toJS(), [2] );
    assert.deepEqual( coll.indices.getIn( ['name', 'Bill'] ).toJS(), [3] );
  });
});

describe( 'removeFromCollection', function() {

  it( 'removes one', function() {
    let coll = initCollection( fixture, ['id', 'name'] );
    coll = removeFromCollection( coll, 3 );
    assert.deepEqual( getObject( coll, 3, false ), undefined );
    assert.deepEqual( coll.objects.get( 1 ), {} );
  });

  it( 'removes many', function() {
    let coll = initCollection( fixture, ['id', 'name'] );
    coll = removeFromCollection( coll, [3, 1] );
    assert.deepEqual( getObject( coll, 3, false ), undefined );
    assert.deepEqual( getObject( coll, 1, false ), undefined );
    assert.deepEqual( coll.objects.get( 0 ), {} );
    assert.deepEqual( coll.objects.get( 1 ), {} );
  });

  it( 'removes alias', function() {
    let coll = initCollection( fixture, ['id', 'name'] );
    coll.alias = coll.alias.set( 'hello', 1 );
    coll = removeFromCollection( coll, [3, 'hello'] );
    assert.deepEqual( getObject( coll, 3, false ), undefined );
    assert.deepEqual( getObject( coll, 1, false ), undefined );
    assert.deepEqual( getObject( coll, 'hello', false ), undefined );
    assert.deepEqual( coll.objects.get( 0 ), {} );
    assert.deepEqual( coll.objects.get( 1 ), {} );
    assert.deepEqual( coll.alias.has( 'hello' ), false );
  });
});

describe( 'aliasIdInCollection', function() {

  it( 'sets alias', function() {
    let coll = initCollection( fixture, ['id', 'name'] );
    coll = aliasIdInCollection( coll, 1, 'hello' );
    assert.deepEqual( getObject( coll, 1 ).id, 'hello' );
    assert.deepEqual( getObject( coll, 'hello' ).id, 'hello' );
    assert.deepEqual( coll.alias.get( 1 ), 'hello' );
  });
});

describe( 'splitJsonApiResponse', function() {

  it( 'flattens objects', function() {
    const response = {
      included: [{
        type: 'Author',
        id: 1,
        attributes: {
          name: 'Frank'
        }
      }],
      data: [{
        type: 'Book',
        id: 2,
        attributes: {
          title: 'A book'
        },
        relationships: {
          authors: {
            data: [{
              type: 'Author',
              id: 1
            }]
          }
        }
      }]
    };
    let data = splitJsonApiResponse( response );
    assert.deepEqual( data.Book, [{_type: 'Book', id: 2, title: 'A book', authors: new Set( [{_type: 'Author', id: 1}] )}] );
    assert.deepEqual( data.Author, [{_type: 'Author', id: 1, name: 'Frank'}] );
  });
});
