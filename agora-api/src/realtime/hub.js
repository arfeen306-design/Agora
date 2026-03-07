const noOpHub = {
  emitToUser() {
    return 0;
  },
  emitToUsers() {
    return 0;
  },
};

let realtimeHub = noOpHub;

function setRealtimeHub(hub) {
  realtimeHub = hub || noOpHub;
}

function getRealtimeHub() {
  return realtimeHub;
}

module.exports = {
  setRealtimeHub,
  getRealtimeHub,
};
