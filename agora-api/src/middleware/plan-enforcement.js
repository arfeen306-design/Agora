const pool = require("../db");
const AppError = require("../utils/app-error");

/**
 * Loads the school's current subscription + plan into req.subscription.
 * Caches for the duration of the request.
 */
async function loadSchoolSubscription(schoolId) {
  const result = await pool.query(
    `
      SELECT
        ss.id AS subscription_id,
        ss.school_id,
        ss.plan_id,
        ss.billing_cycle,
        ss.status,
        ss.current_period_start,
        ss.current_period_end,
        ss.trial_ends_at,
        ss.cancelled_at,
        sp.code AS plan_code,
        sp.name AS plan_name,
        sp.max_students,
        sp.max_staff,
        sp.max_storage_gb,
        sp.ai_tutor_enabled,
        sp.sms_enabled,
        sp.api_access_enabled,
        sp.custom_branding_enabled
      FROM school_subscriptions ss
      JOIN subscription_plans sp ON sp.id = ss.plan_id
      WHERE ss.school_id = $1
      LIMIT 1
    `,
    [schoolId]
  );

  return result.rows[0] || null;
}

/**
 * Middleware factory: require a specific plan feature flag.
 * Usage: requirePlanFeature("ai_tutor_enabled")
 */
function requirePlanFeature(featureFlag) {
  return async (req, _res, next) => {
    try {
      if (!req.auth?.schoolId) {
        return next(new AppError(401, "UNAUTHORIZED", "Authentication required"));
      }

      const subscription = await loadSchoolSubscription(req.auth.schoolId);

      if (!subscription) {
        return next(
          new AppError(
            403,
            "PLAN_REQUIRED",
            "No active subscription found. Please subscribe to a plan."
          )
        );
      }

      if (subscription.status !== "active" && subscription.status !== "trialing") {
        return next(
          new AppError(
            403,
            "SUBSCRIPTION_INACTIVE",
            `Subscription is ${subscription.status}. Please renew to access this feature.`
          )
        );
      }

      if (!subscription[featureFlag]) {
        return next(
          new AppError(
            403,
            "PLAN_FEATURE_UNAVAILABLE",
            `This feature requires a plan upgrade. Current plan: ${subscription.plan_name}`,
            [{ field: "plan", issue: `missing_feature:${featureFlag}` }]
          )
        );
      }

      req.subscription = subscription;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

/**
 * Middleware factory: enforce plan limit before adding resources.
 * Usage: requirePlanLimit("max_students", countQuery)
 * 
 * @param {string} limitField - the plan column (max_students, max_staff, max_storage_gb)
 * @param {Function} countFn - async (schoolId) => currentCount
 */
function requirePlanLimit(limitField, countFn) {
  return async (req, _res, next) => {
    try {
      if (!req.auth?.schoolId) {
        return next(new AppError(401, "UNAUTHORIZED", "Authentication required"));
      }

      const subscription = await loadSchoolSubscription(req.auth.schoolId);

      // No subscription = allow (free tier default)
      if (!subscription) {
        return next();
      }

      if (subscription.status !== "active" && subscription.status !== "trialing") {
        return next();
      }

      const limit = Number(subscription[limitField]) || 0;
      if (limit <= 0) {
        return next();
      }

      const currentCount = await countFn(req.auth.schoolId);
      if (currentCount >= limit) {
        return next(
          new AppError(
            403,
            "PLAN_LIMIT_REACHED",
            `Plan limit reached: ${limit} ${limitField.replace("max_", "")}. Upgrade your plan for more.`,
            [{ field: limitField, issue: `limit:${limit}`, current: currentCount }]
          )
        );
      }

      req.subscription = subscription;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

/** Helper count functions for common limits */
async function countActiveStudents(schoolId) {
  const result = await pool.query(
    "SELECT COUNT(*)::int AS count FROM students WHERE school_id = $1 AND status = 'active'",
    [schoolId]
  );
  return result.rows[0]?.count || 0;
}

async function countActiveStaff(schoolId) {
  const result = await pool.query(
    "SELECT COUNT(*)::int AS count FROM staff_profiles WHERE school_id = $1 AND employment_status = 'active'",
    [schoolId]
  );
  return result.rows[0]?.count || 0;
}

module.exports = {
  loadSchoolSubscription,
  requirePlanFeature,
  requirePlanLimit,
  countActiveStudents,
  countActiveStaff,
};
