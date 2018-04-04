# redux-jam

[![npm version](https://badge.fury.io/js/redux-jam.svg)](http://badge.fury.io/js/redux-jam)
![Downloads](http://img.shields.io/npm/dm/redux-jam.svg?style=flat)

`redux-jam` aims to make interacting with relational database based APIs
easier and more powerful.

## Installation

```bash
npm install redux-jam
```

or

```bash
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

Before data can be manipulated a schema describing the structure of the data
must be defined. There are a number of ways to do it, the two most common are
to define the data manually, or import it automatically using an external
package.

### Manual Definition

Schemas are built using the `Schema` class:

```js
import {Schema} from 'redux-jam'

let schema = new Schema()
```

To define models in a schema, use the `merge` method, which accepts an object
argument describing a part of a schema:

```python
schema.merge({})
```

`merge` may be called any number of times. Each subsequent call will overwrite
any overlapping models.

The structure of the schema object is similar in some ways to the structure of
a JSON-API object. Take for example the following definition of a movie:

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

This defines two models: `movie` and `person`. The `api` sections of each
model are placeholders for calls to API endpoints. They should return promises,
which in turn return JSON-API structured data.

Options for attributes are currently limited to `required`.

Options for relationships:

 * type

 * required

 * many

 * relatedName

### Django + DRF

If you're using Django and DRF, your schema can be loaded into JAM
automatically, which is particularly convenient.

Refer to [Django-JAM](https://github.com/uptick/django-jam)

## Loading Data


## Transactions
