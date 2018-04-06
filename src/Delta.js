import {fromJS} from 'immutable'

export default class Delta {

  constructor(data) {
    if(Map.isMap(data))
      this.data = data
    else
      this.reset(data)
  }

  reset(data) {
    if (data)
      this.data = fromJS(data)
    else
      this.data = new Map()
  }

  isRemove() {
    return this.operation() == 'remove'
  }

  iid() {
    return makeId(
      this._type[0] || this._type[1],
      (this.id[0] !== undefined) ? this.id[0] : this.id[1]
    )
  }

  operation() {
    if (isEmpty(this._type[0]))
      return 'create'
    else if (isEmpty(this._type[1]))
      return 'remove'
    else
      return 'update'
  }

}
