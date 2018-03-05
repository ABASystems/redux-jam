import 'isomorphic-fetch'
import { expect } from 'code'
import sinon from 'sinon'
import { Set } from 'immutable'

import DB from '../src/db'
import { makeId } from '../src/utils'
import { schema, getJsonApiData } from './model-fixture'

// Don't dump stuff to the terminal.
console.debug = () => {}

describe( 'Given a populated instance', () => {
  let db = new DB( null, {schema} )
  db.loadJsonApi( getJsonApiData() )

  describe( 'selecting a foreign-key', () => {

    it( 'returns an instance', () => {
      let book = db.getInstance( 'book', 1 )
      expect( book.next ).to.not.be.undefined()
      expect( book.next._db ).to.not.be.undefined()
    })

    describe( 'when undefined', () => {

      it( 'returns undefined', () => {
        let db = new DB( null, {schema} )
        db.loadJsonApi( getJsonApiData() )
        let book = db.getInstance( 'book', 1 )
        expect( book.authorFK ).to.be.undefined()
      })

    })

  })

  describe( 'resetting', () => {

    it( 'undoes any changes', () => {
      let book = db.getInstance( 'book', 1 )
      expect( book.title ).to.not.equal( 'x' )
      book.title = 'x'
      expect( book.title ).to.equal( 'x' )
      book.reset()
      expect( book.title ).to.not.equal( 'x' )
    })

  })

})
