import { SEEDED_ACCOUNTS, SEEDED_PASSWORD, WEB_APP_URL, makeLoginAs } from "@hifago/e2e-support";

export { SEEDED_ACCOUNTS, SEEDED_PASSWORD };
export const loginAs = makeLoginAs(WEB_APP_URL);
