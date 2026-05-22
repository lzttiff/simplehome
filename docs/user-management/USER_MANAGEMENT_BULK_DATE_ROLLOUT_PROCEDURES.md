# Phase 5: Testing & Rollout Procedures

**Objective**: Complete comprehensive testing of user management features, establish rollout gates, and execute production deployment with verification checkpoints.

---

## 1. Pre-Rollout Verification Checklist

### Code Quality & Testing

- [ ] **Unit Tests Pass**
  - Run: `npm run test`
  - Expect: All tests pass, >90% coverage for user management paths
  - Coverage focus: `server/routes.ts` (password, delete, bulk), `server/storage.ts` (user scoping), `server/auth.ts` (password hashing)

- [ ] **Server Tests Pass**
  - File: `tests/server/user-management.test.ts`
  - Coverage:
    - [ ] Password change: valid, mismatch, min length validation
    - [ ] Account deletion: success, with/without calendar cleanup
    - [ ] Bulk date fill: both modes, task ownership validation
    - [ ] Google Calendar sync status endpoint
  - Run: `npm run test tests/server/user-management.test.ts`

- [ ] **UI Component Tests Pass**
  - File: `tests/client/user-management-ui.test.tsx`
  - Coverage:
    - [ ] Account menu: logout flow, change password dialog
    - [ ] Delete account dialog: password validation, calendar checkbox
    - [ ] Bulk fill modal: date picker, month/year selectors, mode selection
    - [ ] User Settings: Google Calendar ID display, copy button, settings link
  - Run: `npm run test tests/client/user-management-ui.test.tsx`

- [ ] **TypeScript Check Passes**
  - Run: `npm run check`
  - Expect: 0 errors, 0 warnings

- [ ] **Build Succeeds**
  - Run: `npm run build`
  - Expect: Clean build, no errors or warnings

### Data Integrity & Scoping

- [ ] **Legacy Data Guard Passes**
  - Run: `npm run guard:legacy-userid`
  - Expect: Zero legacy records (userId: null) in templates and tasks
  - If fails: Run migration first, then rollback and investigate

- [ ] **Verify Strict User Scoping**
  - Spot check: Query MongoDB directly to confirm all user-owned templates/tasks have `userId` field
  - Command: `db.templates.countDocuments({ userId: null })` should return 0
  - Command: `db.templates.countDocuments({ userId: { $exists: false } })` should return 0

- [ ] **Data Migration Complete**
  - If any legacy data was present:
    - [ ] Ran: `npm run migrate:legacy-user-data --dry-run`
    - [ ] Reviewed: Migration counts match expectations
    - [ ] Executed: `npm run migrate:legacy-user-data --apply`
    - [ ] Verified: `npm run guard:legacy-userid` passes

### Feature Verification

- [ ] **Manual Test: Password Change**
  - User Action: Dashboard → Account Menu → Change Password
  - [ ] Form displays current, new, confirm password fields
  - [ ] Validation: min 8 chars
  - [ ] Validation: password mismatch warning
  - [ ] Submit: Password successfully changes
  - [ ] New password works on re-login

- [ ] **Manual Test: Account Deletion (with calendar cleanup)**
  - User Action: Dashboard → Account Menu → Delete Account
  - [ ] Dialog shows warning about permanent deletion
  - [ ] Password confirmation required
  - [ ] Google Calendar checkbox available if connected
  - [ ] Submit: Account deleted, user logged out
  - [ ] Verify: User cannot log back in
  - [ ] Verify: SimpleHome calendar cleaned up in Google Calendar (if requested)

- [ ] **Manual Test: Bulk Date Fill (fill-empty-only mode)**
  - User Action: Dashboard → Select multiple tasks → Bulk Fill Dates
  - [ ] Modal opens with date picker and mode selector
  - [ ] Month/year jump controls work
  - [ ] Select "fill-empty-only" mode
  - [ ] Pick a date → Submit
  - [ ] Verify: Only tasks with null dates were updated
  - [ ] Verify: Other tasks' dates unchanged

- [ ] **Manual Test: Bulk Date Fill (overwrite mode)**
  - User Action: Dashboard → Select tasks with existing dates → Bulk Fill Dates
  - [ ] Select "overwrite" mode
  - [ ] Pick new date → Submit
  - [ ] Verify: All selected tasks updated to new date

- [ ] **Manual Test: Google Calendar ID Display**
  - User Action: Dashboard → Account Menu → Settings
  - [ ] Google Calendar section visible
  - [ ] Calendar ID displayed if connected
  - [ ] Copy button copies ID to clipboard
  - [ ] "Open Google Calendar Settings" link works
  - [ ] Link opens Google Calendar in new tab

- [ ] **Manual Test: Year Jump (Far-Future Dates)**
  - User Action: Edit task → nextMaintenanceDate picker
  - [ ] Month/year dropdowns visible
  - [ ] Can select years from (current - 10) to (current + 30)
  - [ ] No future dates selectable (minor schedule assumes past maintenance)

### API Contract Verification

- [ ] **PATCH /api/auth/password**
  - Request validation: ✓ currentPassword required, ✓ newPassword required
  - Response: ✓ 200 on success, ✓ 403 on mismatch, ✓ 400 on validation error

- [ ] **DELETE /api/auth/account**
  - Request validation: ✓ password required, ✓ deleteCalendarData optional
  - Response: ✓ Structured cleanup report, ✓ 200 success, ✓ 403 on password mismatch

- [ ] **POST /api/tasks/bulk-next-maintenance-date**
  - Request validation: ✓ taskIds non-empty, ✓ kind in [minor, major], ✓ date is YYYY-MM-DD, ✓ mode in [fill-empty-only, overwrite]
  - Response: ✓ { updated, skipped, failed }, ✓ user ownership enforced

- [ ] **GET /api/calendar/google/sync/status**
  - Response: ✓ { configured, connected, calendarId, accountEmail, lastSyncedAt, activeScopeCount }

### Logging & Observability

- [ ] **Structured Logs Generated**
  - Set: `LOG_LEVEL=DEBUG`
  - Trigger password change: Look for `PASSWORD_CHANGE_SUCCESS` event
  - Trigger account deletion: Look for `ACCOUNT_DELETION_SUCCESS` event
  - Trigger bulk date fill: Look for `BULK_DATE_FILL_SUCCESS` event
  - Verify: Logs contain userId, timestamp, operation details

- [ ] **No Sensitive Data in Logs**
  - Search logs for plaintext passwords: Should be 0 results
  - Search logs for auth tokens: Should be 0 results
  - Confirm: Only userId and operation metadata logged

---

## 2. Staged Rollout Plan

### Stage 1: Shadow Deployment (Monitoring Only)
**Duration**: 1-2 days  
**Risk**: Low (no user impact)

- [ ] Deploy code to staging environment
- [ ] Enable structured logging at DEBUG level
- [ ] Monitor all `accountEventLogger` events
- [ ] Watch for errors in password change, account deletion paths
- [ ] Verify: No unexpected 403/500 errors

**Exit Criteria**:
- Zero errors in account operation paths over 24 hours
- All events successfully structured and logged

### Stage 2: Beta Users (10-20 users)
**Duration**: 3-5 days  
**Risk**: Low (limited user base)

- [ ] Deploy to production
- [ ] Identify 10-20 trusted users (preferably internal team)
- [ ] Notify: "New features available: change password, delete account, bulk date operations"
- [ ] Monitor logs for errors at WARN/ERROR level
- [ ] Collect feedback on UX/workflow
- [ ] Watch for: Session invalidation issues, bulk operation failures

**Exit Criteria**:
- Zero critical errors reported
- At least 5 users test each feature successfully
- No data loss or data leakage incidents

### Stage 3: Gradual Rollout (50% of users)
**Duration**: 7 days  
**Risk**: Medium (larger user base)

- [ ] Enable feature flag: `FEATURE_USER_MANAGEMENT=50`
- [ ] 50% of users see account menu + bulk operations
- [ ] Monitor error rates: `ACCOUNT_DELETION_FAILED`, `CALENDAR_CLEANUP_FAILED`
- [ ] Monitor performance: bulk date fill latency
- [ ] Watch for: Session revalidation issues, race conditions

**Success Metrics**:
- Error rate < 0.5%
- Average account deletion time < 5s
- Average bulk fill latency < 2s

### Stage 4: Full Rollout (100% of users)
**Duration**: On demand (after Stage 3 stable)

- [ ] Remove feature flag
- [ ] All users have access to full feature set
- [ ] Continue monitoring for 7 days post-rollout
- [ ] Response plan active for any incidents

**Success Metrics**:
- Error rate < 0.1%
- Zero data loss incidents
- Zero unintended data exposure

---

## 3. Rollback Plan

**Triggers for Rollback**:
1. Data loss incident (task/template deletion without user deletion)
2. Cross-user data leakage (user A sees user B's data)
3. Password change failures > 1% error rate
4. Calendar cleanup destroying user's Google Calendar events
5. Session not invalidating after account deletion

**Rollback Steps**:
1. Identify root cause from logs (accountEventLogger)
2. Immediately disable feature flag: `FEATURE_USER_MANAGEMENT=false`
3. Revert to previous code version
4. If data loss: Restore from MongoDB backup (pre-rollout)
5. Notify affected users with explanation + remediation
6. Post-mortem: Log findings in `docs/PHASE_5_INCIDENT_REPORTS.md`

**Rollback Validation**:
- [ ] Old features work (no regression)
- [ ] Users can still log in
- [ ] Existing data accessible

---

## 4. Monitoring & Alerting

### Key Metrics to Track

| Metric | Alert Threshold | Action |
|--------|-----------------|--------|
| `ACCOUNT_DELETION_FAILED` events/hour | > 5 | Investigate root cause |
| `CALENDAR_CLEANUP_FAILED` events/hour | > 3 | Check Google API quota |
| `PASSWORD_CHANGE_FAILED` events/hour | > 10 | Check auth service |
| Bulk date fill latency p95 | > 5s | Investigate DB query performance |
| Session invalidation delay | > 2s | Check session store |
| Cross-user task query incidents | > 0 | IMMEDIATE ROLLBACK |

### Logging Dashboard

**Set up alerts for**:
```json
{
  "type": "ACCOUNT_EVENT",
  "eventType": { "$in": ["ACCOUNT_DELETION_FAILED", "CALENDAR_CLEANUP_FAILED", "PASSWORD_CHANGE_FAILED"] }
}
```

---

## 5. Deployment Checklist

Before deploying to production:

- [ ] All tests pass (`npm run test`)
- [ ] TypeScript check passes (`npm run check`)
- [ ] Build succeeds (`npm run build`)
- [ ] Code review approved (at least 1 reviewer)
- [ ] Legacy data guard passes (`npm run guard:legacy-userid`)
- [ ] Data migration complete (if needed)
- [ ] Feature flags configured correctly
- [ ] Logging enabled at appropriate level
- [ ] Monitoring dashboards created
- [ ] Runbook reviewed by ops team
- [ ] Rollback procedure tested in staging
- [ ] Team on-call for 48h post-deployment
- [ ] Customer notification sent (if applicable)

---

## 6. Post-Deployment Verification (48h Window)

- [ ] No critical errors in logs
- [ ] User feedback positive or neutral
- [ ] No performance degradation
- [ ] Error rates stable/decreasing
- [ ] Data integrity intact (spot checks)
- [ ] Session invalidation working
- [ ] Bulk operations completing successfully

---

## 7. Long-term Monitoring (7+ days)

- [ ] Continue alerts from Section 4
- [ ] Weekly report: Account operations summary
- [ ] Monthly audit: Verify no unauthorized data access
- [ ] Quarterly: Performance tuning if needed

---

## 8. Documentation & Knowledge Transfer

- [ ] [ ] Add operational runbook to team wiki
- [ ] [ ] Document account deletion data retention policy (if any)
- [ ] [ ] Document password change audit trail requirements
- [ ] [ ] Create FAQ for end users (account features)
- [ ] [ ] Update API documentation with new endpoints
- [ ] [ ] Training session for support team

---

## Appendix: Observability Query Examples

### Check Password Change Success Rate
```javascript
db.logs.find({
  type: "ACCOUNT_EVENT",
  eventType: { $in": ["PASSWORD_CHANGE_SUCCESS", "PASSWORD_CHANGE_FAILED"] }
}).count()
```

### Check Calendar Cleanup Performance
```javascript
db.logs.find({
  type: "ACCOUNT_EVENT",
  eventType: "CALENDAR_CLEANUP_SUCCESS"
}).aggregate([
  { $group: { _id: null, avgDuration: { $avg: "$duration" }, count: { $sum: 1 } } }
])
```

### Identify Users with Failed Deletions
```javascript
db.logs.find({
  type: "ACCOUNT_EVENT",
  eventType: "ACCOUNT_DELETION_FAILED"
}).distinct("userId")
```

### Monitor Bulk Operations
```javascript
db.logs.find({
  type: "ACCOUNT_EVENT",
  eventType: { $in": ["BULK_DATE_FILL_SUCCESS", "BULK_DATE_FILL_FAILED"] }
})
```

---

## Approval & Sign-off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Engineering Lead | | | |
| QA Lead | | | |
| Operations Lead | | | |
| Product Manager | | | |

---

## Related Documents

- [USER_DATA_MIGRATION_AND_STRICT_SCOPING_RUNBOOK.md](../USER_DATA_MIGRATION_AND_STRICT_SCOPING_RUNBOOK.md) — Legacy data migration procedures
- [USER_MANAGEMENT_AND_BULK_DATE_PLAN.md](USER_MANAGEMENT_AND_BULK_DATE_PLAN.md) — Feature specifications
- Test files:
  - `tests/server/user-management.test.ts` — Server API tests
  - `tests/client/user-management-ui.test.tsx` — UI component tests
