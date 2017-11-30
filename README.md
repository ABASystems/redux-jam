# redux-jam

`redux-jam` aims to make interacting with relational database based
APIs easier and more powerful.

NOTE: redux-jam is under heavy development and will likely undergo
significant interface changes.

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

Using the list of object IDs in `allMovies`, the first movie is
retrieved from the local database using `db.getInstance`. This
returns a light wrapper around the data retrieved via the API. The
many-to-many relationship of `actors` is accessible using an
interface similar to Django's; `firstMovie.actors.all()` returns
all people in the actors relationship.

### Mutations

Mutations against the local DB are carried by altering an instance of
a model retrieved with `db.getInstance`. For example, consider the
following:

```js
const movie = db.getInstance( movieId )
movie.title = 'Jaws'
movie.save()
```

This will alter the loaded movie instance and save to the local cache
only. Again, this will not synchronise with the server, it will only
update the Redux cache. Priort to `movie.save()` the changes are not
cached to Redux, they are purely local to the current function.

Please see Synchronising for details on pushing to the server.

## Transactions

One of the more powerful components of JAM is the transactional 
higher-order component. Often, we will want to make changes to, and/or
create models of different types, all at once. In order to facilitate
easy rollback and committing of such changes with a consistent
interface, JAM uses `TransactionComponent`. Consider the following:

```js
@TransactionComponent
class CreateMovie extends Component {
  render() {
    const { db, movieId } = this.props
    const movie = db.getInstance( movieId )
    return (
      <input
        name="title"
        onChange={x => {
          movie.title = x
          movie.save()
        }}
      />
      <button
        name="commit"
        onClick={this.commitTransaction}
      />
      <button
        name="abort"
        onClick={this.abortTransaction}
      />
    )
  }
}
```

The above allows for creating a new movie entry in our local Redux
state. For the duration of the transaction (for as long as the
component is mounted), the `db` property will be a transaction
database. For all intents and purposes this is identical to the
original database, but any changes to it will create a fork in the
database that is not carried over to any component above or outside
this instance of `CreateMovie`.

By clicking the `commit` button the temporary transactional database
is merged with the primary database, saving its contents to the
Redux state.

By clicking the `abort` button the temporarty transactional database
is discarded.

There are two major advantages to this approach:

 1. Any number of alterations to the database may be carried out, and
    are not limited to alterations to the current model. This means
    related objects may be created, edited, or deleted, and they are
    all contained within the transaction.
    
 2. All alterations are immediately visible to any component using the
    transactional `db` property, but not to any other component. This
    hides the transaction from any other component that may not wish
    to have its contents altered by temporary information.

## Synchronising

Up until now all mutations have been strictly local, i.e. they are
stored only in the Redux state. In order to persist these changes
to the server, a single call to a databases `sync` method is required:

```js
@TransactionComponent
class CreateMovie extends Component {
  render() {
    const { db, movieId } = this.props
    const movie = db.getInstance( movieId )
    return (
      <input
        name="title"
        onChange={x => {
          movie.title = x
          movie.save()
          this.saveTransaction()
        }}
      />
      <button
        name="commit"
        onClick={x => {
          this.commitTransaction()
          this.commit()
          this.sync()
        }
      />
      <button
        name="abort"
        onClick={this.abortTransaction}
      />
    )
  }
}
```

TODO: Make the above a bit easier before continuing...
