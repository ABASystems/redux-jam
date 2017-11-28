# redux-jam

`redux-jam` aims to make interacting with relational database based
APIs easier and more powerful.

## Installation

```bash
npm install redux-jam`
```

or

```
yarn add redux-jam
```

Add the JAM model reducer to your root reducer:

```js
import {reducer as model} from 'redux-jam'

const rootReducer = combineReducers({
  model,
  ...
})

export default rootReducer
```


## Defining a Schema

Before data can be manipulated a schema describing the structure of
the data must be defined. There are a number of ways to do it, the
two most common are to define the data manually, or import it
automatically using an external package.

### Manual Definition

Schemas are built using the `Schema` class:

```js
import {Schema} from 'redux-jam'

let schema = new Schema()
```

To define models in a schema, use the `merge` method, which accepts
an object argument describing a part of a schema:

```python
schema.merge({...})
```

`merge` may be called any number of times. Each subsequent call will
overwrite any overlapping models.

The sructure of the schema object is similar in some ways to the
structure of a JSON-API object. Take for example the following
definition of a movie:

```js
{
  movie: {
    attributes: {
      name: {
        required: true        
      },
      duration: {}
    },
    relationships: {
      actors: {
        type: "person",
        many: true,
        relatedName: "acted_in"
      }
    }
    api: {
      list: () => {},
      detail: () => {},
      create: () => {},
      update: () => {},
      delete: () => {}
    }
  },
  person: {
    attributes: {
      name: {
        required: true
      }
    },
    api: {
      list: () => {},
      detail: () => {},
      create: () => {},
      update: () => {},
      delete: () => {}
    }
  }
}
```

This defines two models: `movie` and `person`. The `api` sections of
each model are placeholders for calls to API endpoints. They should
return promises, which in turn return JSON-API structured data.

Options for attributes are currently limited to `required`.

Options for relationships:

 * type

 * required

 * many

 * relatedName

### Django + DRF

If you're using Django and DRF, your schema can be loaded into JAM
automatically, which is particularly convenient. TODO: Include a link
to django-jam once it's up.


## Queries

Performing queries is managed by `DBComponent`, a higher-order
component. By wrapping your components numerous queries may be
specified simultaneously, retrieved, and injected into the
sub-component's props.

Take, for example, a component designed to render a movie from above:

```js
import React, { Component } from 'react'
import { DBComponent } from 'redux-jam'

const query = {
  name: 'movieQuery',
  queries: {
    allMovies: props => fetch('/api/v1/movies')
  }
}

@DBComponent
class ShowMovies extends Component {
  render() {
    const { loading, allMovies, db } = this.props
    ...
  }
}
```

The `loading` prop is set to `true` when the queries are still being
carried out. Once `false`, the a set of identifiers will be placed in
`allMovies`. `db` is an object designed to provide access to the
details of the loaded movies.


## The Database Object

When using `include` in a JSON-API query many additional objects of
varying types may be returned. These included objects are cached in
the database object for later access.

Taking the ongoing example of movies and people, let's extract the
list of actors for the first returned movie:

```js
@DBComponent
class ShowMovies extends Component {
  render() {
    const { loading, allMovies, db } = this.props

    const firstMovie = db.getInstance( allMovies[0] )
    const actors = firstMovie.actors.all()
  }
}
```

TODO


## Transactions


## Synchronising
