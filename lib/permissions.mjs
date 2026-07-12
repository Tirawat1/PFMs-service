// Whether `me` may attach/detach/mark-fixed documents on `request` — the requester
// themself, or an admin. Having the general "create" permission is not enough.
export function canManageRequestDocs(me, request, admin) {
  return admin || request.requesterId === me.id;
}
