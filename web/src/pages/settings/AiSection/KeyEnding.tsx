/** "Key ending in ••••1234", the same in every state that has a key. */
export function KeyEnding({ last4 }: { last4: string }) {
  return <p className="field key-ending" id="ai-last4">Key ending in ••••{last4}</p>;
}
