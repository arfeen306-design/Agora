BEGIN;

-- Backfill legacy plaintext demo credentials to bcrypt hashes.
-- This keeps existing development databases working after removing plaintext auth fallback.
UPDATE users
SET password_hash = '$2a$10$5jPzs6GWf4P6/3wHq690TOhs9vsg4F1LmtFixJTIx21aQQuw5igpi'
WHERE LOWER(email) = 'admin@agora.com'
  AND password_hash = 'admin123';

UPDATE users
SET password_hash = '$2a$10$8npSDRlRr6QwW.lDp4pF.uHz9iZ/txmp/0fuMP88F/zGu7fTZjDEm'
WHERE LOWER(email) = 'teacher1@agora.com'
  AND password_hash = 'teach123';

UPDATE users
SET password_hash = '$2a$10$6bjj90IyidJjLa/IBcVPGu0Inpy5Pp.mA9oVUh0PNhXzExQs3l.I2'
WHERE LOWER(email) = 'parent1@agora.com'
  AND password_hash = 'pass123';

UPDATE users
SET password_hash = '$2a$10$IFDV4FPYvHZ9h87saTWNY.VLI0DMlLkiuk9BiiIeAverQTwuWvZLy'
WHERE LOWER(email) = 'student1@agora.com'
  AND password_hash = 'student123';

UPDATE users
SET password_hash = '$2a$10$cw6mCAJq7qq.XVBDLCw/w.h0dnaYIQ.He/QByQlCd3b3yEqed3NTO'
WHERE LOWER(email) = 'principal@agora.com'
  AND password_hash = 'principal123';

UPDATE users
SET password_hash = '$2a$10$Ns/mCo/Uax5QLCxi4/UNdOrSIn4LHwxZIPa02fhZbjEVNFF0xm4Li'
WHERE LOWER(email) = 'viceprincipal@agora.com'
  AND password_hash = 'vice123';

UPDATE users
SET password_hash = '$2a$10$cCjVtceQ/b7VDVHMTWDm8egQ9OY67Hbs5jZme22l/6t8aiG8r9CH2'
WHERE LOWER(email) = 'hm.middle@agora.com'
  AND password_hash = 'hm123';

UPDATE users
SET password_hash = '$2a$10$O8BJZKBWKFM9zutglQQb0.GBUrh8riKPTQps3IELXBU7MvlS.t4HO'
WHERE LOWER(email) = 'accountant@agora.com'
  AND password_hash = 'accounts123';

UPDATE users
SET password_hash = '$2a$10$FOHCYDug1bR3o8C2D5Urbu6/ppZXxq15MD6Pc5ynCWJZRv/E0Xo1e'
WHERE LOWER(email) = 'frontdesk1@agora.com'
  AND password_hash = 'front123';

COMMIT;
