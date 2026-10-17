# Demonstration data

`seed-demo.json` contains the same sample projects that the in-browser **demo mode** uses
(12 projects across all departments, with quotations, expenses, vendor payments, client
receipts and LD/TDS deductions). Amounts are integer **paise**.

**Never import this into the production database.** Use it only with a separate
demo/staging Firebase project:

1. Create a second Firebase project (e.g. `garuda-pro-demo`) and follow the main README setup.
2. Bootstrap the administrator there as described in the main README.
3. Firebase Console → Realtime Database → ⋮ → **Import JSON** at a child path is not
   supported, so import each top-level key separately, or run (with the Firebase CLI):

   ```bash
   firebase database:update / demo/seed-demo.json --project garuda-pro-demo
   ```

   `database:update` merges, so your `users`, `usernames` and `meta` nodes are kept.

The file intentionally contains no users, passwords or UIDs. Dates were generated relative to
the export date; regenerate with:

```bash
node -e "import('./js/demo-data.js').then(({buildDemoTree})=>{const t=buildDemoTree();delete t.users;delete t.usernames;delete t.meta;require('fs').writeFileSync('demo/seed-demo.json',JSON.stringify(t,null,1))})"
```
