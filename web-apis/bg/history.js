const historyDb = require('../../ddbs/history')

// exported api
// =

module.exports = {
  async addVisit (...args) {
    return historyDb.addVisit(0, ...args)
  },

  async getVisitHistory (...args) {
    return historyDb.getVisitHistory(0, ...args)
  },

  async getMostVisited (...args) {
    return historyDb.getMostVisited(0, ...args)
  },

  async search (...args) {
    return historyDb.search(...args)
  },

  async removeVisit (...args) {
    return historyDb.removeVisit(...args)
  },

  async removeAllVisits (...args) {
    return historyDb.removeAllVisits(...args)
  },

  async removeVisitsAfter (...args) {
    return historyDb.removeVisitsAfter(...args)
  }
}
