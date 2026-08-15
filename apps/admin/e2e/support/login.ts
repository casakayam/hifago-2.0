import { SEEDED_ACCOUNTS, SEEDED_PASSWORD, ADMIN_APP_URL, makeLoginAs } from "@hifago/e2e-support";

export { SEEDED_ACCOUNTS, SEEDED_PASSWORD };
export const loginAs = makeLoginAs(ADMIN_APP_URL);
