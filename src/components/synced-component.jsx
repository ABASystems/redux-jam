import React, {Component} from 'react';
import {bindActionCreators} from 'redux';
import {connect} from 'react-redux';

import * as modelActions from '../actions';
import DB from '../db';

/**
 * Higher-order component to automatically insert models loaded
 * from a server.
 */
export default (ComposedComponent, options) => {

  /**
   * Connect the wrapper component to the model state.
   */
  return connect(

    state => {
      const {name, schema} = options || {};
      const {model = {}} = state;
      const {views = {}} = model;
      const db = new DB( model.db, {schema} );
      const content = views[name] || {};
      console.debug( 'SyncedComponent: ', content );
      return {
        ...content,
        db
      };
    },

    dispatch => bindActionCreators( modelActions, dispatch )

  )(

    class SyncedComponent extends Component {

      /**
       * Need to load the requried models.
       */
      componentWillMount() {
        console.debug( 'SyncedComponent: Loading.' );
        this.props.loadModelView( {...options, props: this.props} );
      }

      render() {
        return <ComposedComponent { ...this.props } />;
      }
    }

  );

}
