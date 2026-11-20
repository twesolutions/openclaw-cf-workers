// Approved 2026-11-20: keep Sopsbot awake Monday-Friday 07:00-18:00 Pacific.
// Outside this window the normal 15-minute idle sleep applies. The time zone
// database handles PST/PDT; never hard-code a UTC offset here.
export const BUSINESS_TIME_ZONE='America/Los_Angeles';
export const BUSINESS_START_MINUTE=7*60;
export const BUSINESS_END_MINUTE=18*60;
const WEEKDAYS=new Set(['Mon','Tue','Wed','Thu','Fri']);
const formatter=new Intl.DateTimeFormat('en-US',{timeZone:BUSINESS_TIME_ZONE,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export function isBusinessHours(at:Date|number):boolean{
 const date=typeof at==='number'?new Date(at):at;
 if(!Number.isFinite(date.getTime()))return false;
 const parts=Object.fromEntries(formatter.formatToParts(date).map(p=>[p.type,p.value]));
 if(!WEEKDAYS.has(parts.weekday))return false;
 const minute=Number(parts.hour)*60+Number(parts.minute);
 return minute>=BUSINESS_START_MINUTE&&minute<BUSINESS_END_MINUTE;
}
