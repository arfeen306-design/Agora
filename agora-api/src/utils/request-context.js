const { AsyncLocalStorage } = require("async_hooks");

const storage = new AsyncLocalStorage();

function requestContext(req, _res, next) {
  storage.run({ req }, next);
}

function getRequest() {
  return storage.getStore()?.req || null;
}

function getCurrentSchoolId() {
  return getRequest()?.auth?.schoolId || null;
}

module.exports = {
  requestContext,
  getRequest,
  getCurrentSchoolId,
};
