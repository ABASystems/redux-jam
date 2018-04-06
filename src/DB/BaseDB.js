export default class BaseDB {

  makeDeltas() {
    let deltas = []
    let depTbl = this.makeDependencyTable()

    // Process IIDs in turn until they're all gone.
    let iid = this.getNextReady(depTbl)
    while(iid) {
      if (depTbl[iid].optional.size > 0) {
        const [mainDelta, auxDelta] = this.splitDelta(depTbl[iid])
        deltas.push(mainDelta)
        depTbl[iid].diff = auxDelta
        depTbl[iid].required = depTbl[iid].optional
        depTbl[iid].optional = new Set()
      }
      else {
        deltas.push(depTbl[iid].diff)
        delete depTbl[iid]
      }
      iid = this.getNextReady(depTbl)
    }

    // Add removals. This is done by iterating over all records
    // in tail and finding any that don't exist in head.
    // TODO: This has poor O.
    this.schema.models.map((model, type) => {
      const headTbl = this.getTable(model.type, 'head')
      const tailTbl = this.getTable(model.type, 'tail')
      for (const tailObj of tailTbl.iterRecords()) {
        const headObj = headTbl.get(tailObj.id)
        if (headObj) // ony want removals
          continue
        const dlt = model.delta(tailObj, headObj)
        if (!dlt) // can this even happen?
          continue
        deltas.push(dlt)
      }
    })

    return deltas
  }

  splitDelta(options) {
    const {diff, optional} = options
    let auxDelta = {}
    const model = this.getModel(diff._type[1])
    for (const fieldName of model.iterRelationships()) {
      if (!(fieldName in diff))
        continue
      const field = model.getField(fieldName)
      if (field.get('many')) {
        auxDelta[fieldName] = [
          diff[fieldName][0].filter(x => !optional.has(x)),
          diff[fieldName][1].filter(x => !optional.has(x))
        ]
        diff[fieldName] = [
          diff[fieldName][0].filter(x => optional.has(x)),
          diff[fieldName][1].filter(x => optional.has(x))
        ]
      }
      else {
        //        if (!isEmpty(diff[fieldName][1]) {
        if (optional.has(diff[fieldName][1])) {
          auxDelta[fieldName] = diff[fieldName]
          delete diff[fieldName]
        }
      }
    }
    return [diff, auxDelta]
  }

  // TODO
  _makeDependencyTable() {
    let tbl = {}
    this.schema.models.map((model, type) => {
      const headTbl = this.getTable(model.type, 'head')
      const tailTbl = this.getTable(model.type, 'tail')
      for (const headObj of headTbl.iterObjects()) {
        const tailObj = tailTbl.get(headObj.id)
        const diff = model.diff(tailObj, headObj)
        if (!diff)
          continue
        const id = this.getId(headObj)
        const tblId = `${id._type}|${id.id}`
        tbl[tblId] = {
          id: id,
          diff,
          required: new Set(),
          optional: new Set()
        }
        for (const fieldName of model.iterRelationships()) {
          const field = model.getField(fieldName)
          if (diff[fieldName] === undefined)
            continue
          let related = diff[fieldName][1]
          if (isEmpty(related))
            continue
          if (!field.get('many'))
            related = [related]
          let kind = field.get('required') ? 'required' : 'optional'
          for (const relId of related) {
            // TODO: Why would relId be null?
            if (isEmpty(relId) || this.exists(relId, 'tail'))
              continue
            tbl[tblId][kind] = tbl[tblId][kind].add(`${relId._type}|${relId.id}`)
          }
        }
      }
    })
    return tbl
  }

  // TODO
  _getNextReady(tbl) {
    let next
    for (const id of Object.keys(tbl)) {
      if (tbl[id].required.size == 0) {
        if (next !== undefined) {
          if (tbl[id].optional.size < tbl[next].optional.size)
            next = id
        }
        else
          next = id
      }
      if (next !== undefined && tbl[next].optional.size == 0)
        break
    }
    if (next) {
      const nextId = `${tbl[next].id._type}|${tbl[next].id.id}`
      for (const id of Object.keys(tbl)) {
        tbl[id].required = tbl[id].required.remove(nextId)
        tbl[id].optional = tbl[id].optional.remove(nextId)
      }
    }
    return next
  }

  /**
   * Commit the current head.
   *
   * Once a head state is ready to be considered permanent, it should be
   * committed. This compacts the existing diffs and sets the tail
   * of the DB to be the head.
   */
  commit() {
    let diffs = this.getDiffs()

    // Check the diffs for many-to-many updates and split those off into separate
    // diffs; they need separate API calls to set.
    let newDiffs = []
    for( let diff of diffs ) {
      let extraDiffs = []
      const id = getDiffId( diff )
      const model = this.getModel( diff._type[0] || diff._type[1] )
      for( const fieldName of model.iterManyToMany() ) {
        if( !diff[fieldName] )
          continue
        if( diff[fieldName][0] && diff[fieldName][0].size ) {
          extraDiffs.push({
            _type: [id._type, id._type],
            id: [id.id, id.id],
            [fieldName]: [diff[fieldName][0], new OrderedSet()]
          })
        }
        if( diff[fieldName][1] && diff[fieldName][1].size ) {
          extraDiffs.push({
            _type: [id._type, id._type],
            id: [id.id, id.id],
            [fieldName]: [new OrderedSet(), diff[fieldName][1]]
          })
        }
        delete diff[fieldName]
      }

      // Only add the original diff if it either does not exist in the
      // tail, or has attributes to be set.
      if (!this.exists(getDiffId(diff), 'tail') || Object.keys(diff).length > 2)
        newDiffs.push(diff)

      for(const d of extraDiffs)
        newDiffs.push(d)
    }

    // The new diffs need to be inserted after the diffs corresponding
    // to the current tail pointer. The diffs after the tail pointer
    // should be discarded, as the new diffs represent the compacted
    // version of those. The tail pointer should also be updated to
    // the new location.
    console.debug(`DB: Committing ${newDiffs.length} new diff(s)`)
    const tp = this.data.get('tailptr')
    this.data = this.data.update('diffs', x => x.slice(0, tp).concat(newDiffs))
    this.data = this.data.update('tailptr', x => x + newDiffs.length)

    // Reset tail to head.
    this.data = this.data.set('tail', this.data.get('head'))
  }

}
