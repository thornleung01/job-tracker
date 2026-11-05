/** "interview_invite" as "Interview invite", for the line that says how an email was read. */
export const eventLabel = (event: string): string => {
  const words = event.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};
