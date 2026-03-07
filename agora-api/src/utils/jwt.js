const jwt = require("jsonwebtoken");
const config = require("../config");

function signAccessToken(user, roles) {
  return jwt.sign(
    {
      token_type: "access",
      school_id: user.school_id,
      roles,
    },
    config.jwt.accessSecret,
    {
      subject: user.id,
      expiresIn: config.jwt.accessExpiresIn,
    }
  );
}

function signRefreshToken(user, sessionId) {
  return jwt.sign(
    {
      token_type: "refresh",
      school_id: user.school_id,
      sid: sessionId,
    },
    config.jwt.refreshSecret,
    {
      subject: user.id,
      expiresIn: config.jwt.refreshExpiresIn,
    }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, config.jwt.accessSecret);
}

function verifyRefreshToken(token) {
  return jwt.verify(token, config.jwt.refreshSecret);
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
};
