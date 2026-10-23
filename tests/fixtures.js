import { test as base, expect } from "@playwright/test";

// Every test fails if the page throws or rejects without catching it.
export const test = base.extend({
  pageErrors: [
    async ({ page }, use) => {
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await use(errors);
      expect(errors, "uncaught errors in the page").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
