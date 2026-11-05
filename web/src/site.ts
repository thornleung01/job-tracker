// Where this site's source lives. Fixed in code on purpose: the setup page never builds these links from the page URL.
export const GITHUB_REPO = "thornleung01/job-tracker";

/** GitHub's editor for the file that holds the app IDs. */
export const editConfigUrl = `https://github.com/${GITHUB_REPO}/edit/main/web/site-config.json`;

/** The deploy that publishes the site after a commit. */
export const actionsUrl = `https://github.com/${GITHUB_REPO}/actions/workflows/pages.yml`;
