function todayParts(now = /* @__PURE__ */ new Date()) {
  return [now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate()];
}
function calendarAge(dob, now = /* @__PURE__ */ new Date()) {
  const [y, m, d] = dob.split("-").map(Number);
  const [ty, tm, td] = todayParts(now);
  let age = ty - y;
  if (tm < m || tm === m && td < (d || 1)) age -= 1;
  return age;
}
function isFutureDate(date, now = /* @__PURE__ */ new Date()) {
  const [ty, tm, td] = todayParts(now);
  const today = `${ty}-${String(tm).padStart(2, "0")}-${String(td).padStart(2, "0")}`;
  return date > today;
}
function lastDayOfMonth(year, month1) {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}
function monthsAgoISO(months, now = /* @__PURE__ */ new Date()) {
  const [ty, tm, td] = todayParts(now);
  const target = new Date(Date.UTC(ty, tm - 1 - months, 1));
  const y = target.getUTCFullYear();
  const m = target.getUTCMonth() + 1;
  const d = Math.min(td, lastDayOfMonth(y, m));
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
export {
  calendarAge,
  isFutureDate,
  monthsAgoISO,
  todayParts
};
