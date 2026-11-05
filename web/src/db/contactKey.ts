// What a person's correction is filed under: "<application id>|<address>", or "<application id>|name:<letters>" for someone
// who was only named in a message. One rule for saving a correction and for importing one.
const CONTACT_KEY = /^\d+\|(?:[^@\s|]+@[^@\s|]+|name:[a-z]+)$/;

export function isContactKey(key: string): boolean {
  return CONTACT_KEY.test(key);
}
