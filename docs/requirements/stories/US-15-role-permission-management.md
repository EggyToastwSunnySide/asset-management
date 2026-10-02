---
ID: US-15
Title: Manage roles and enforce permissions
Sprint: TBD
Status: done
Triggers: []
---

## Story

As a system administrator, I want to define roles and assign them to users,
so that each user can perform only the asset-management operations they are
authorized to perform.

## Acceptance criteria

- [x] The checked-in requirements define a stable action-permission catalogue and an initial built-in role matrix
- [x] A user may have multiple active roles, and effective permissions are the union of permissions from those roles
- [x] Built-in System Administrator, Asset Manager and Viewer role templates are seeded and cannot be renamed, deactivated or edited
- [x] An authorized administrator can create, update and deactivate custom roles and choose their permission sets
- [x] An authorized administrator can view users and atomically replace another user's role assignments
- [x] A user cannot edit their own assignments, delegate permissions they do not possess or remove the final active usable administrator
- [x] Role and assignment changes are transactional, audited and promptly invalidate affected active sessions
- [x] Backend endpoints deny by default and enforce explicit permissions for asset reads and mutations, exports, private export profiles and access administration
- [x] Asset export requires both asset-view and export permissions
- [x] Export profiles remain private to their owner and cross-owner identifiers retain privacy-preserving not-found behavior
- [x] Frontend routes, navigation and controls reflect effective permissions without treating UI hiding as the security boundary
- [x] Users without a permission do not trigger avoidable forbidden frontend queries or see unusable action menus
- [x] Automated backend and frontend tests cover the role matrix, multiple-role union, no-role denial, role management, assignment invariants and permission enforcement

## Initial permission catalogue

- `assets.view`, `assets.create`, `assets.update`, `assets.archive`, `assets.restore`
- `exports.run`
- `exportProfiles.view`, `exportProfiles.create`, `exportProfiles.update`, `exportProfiles.delete`
- `users.view`
- `roles.view`, `roles.create`, `roles.update`, `roles.assign`

## Initial built-in role matrix

- **System Administrator:** all permissions.
- **Asset Manager:** all asset, export and private export-profile permissions.
- **Viewer:** `assets.view` only.

## Out of scope

Department, location, self, assigned-asset or other row scopes; field-level
authorization; account-creation UI; security-audit viewer; delegated
administrative domains; workflow segregation beyond self-elevation and
last-administrator protection.

## Notes

This story deliberately implements action-level RBAC. It does not invent scope
semantics that the current asset data model cannot represent consistently.
Conforming ADRs remain pending because the occurrence sources and
`tools/records` generator are absent; generated files under `docs/views/` must
not be edited by hand.
