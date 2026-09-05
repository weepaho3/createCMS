import { eslintCompatPlugin } from "@oxlint/plugins";

import { noChainedTypeAssertionsRule } from "./rules/no-chained-type-assertions.ts";
import { noConditionalEmptyObjectSpreadRule } from "./rules/no-conditional-empty-object-spread.ts";
import { noObjectParametersRule } from "./rules/no-object-parameters.ts";
import { noReflectApplyRule } from "./rules/no-reflect-apply.ts";
import { noReflectGetRule } from "./rules/no-reflect-get.ts";
import { noForbiddenTermInSymbolNamesRule } from "./rules/no-shape-in-symbol-names.ts";
import { noUnknownTypeAliasesRule } from "./rules/no-unknown-type-aliases.ts";
import { noWidenThenAssertRule } from "./rules/no-widen-then-assert.ts";

/** Oxlint rules that reject patterns which discard type evidence or hide it behind casts and names. */
const antiSlopPlugin = eslintCompatPlugin({
	meta: { name: "anti-slop" },
	rules: {
		"no-chained-type-assertions": noChainedTypeAssertionsRule,
		"no-conditional-empty-object-spread": noConditionalEmptyObjectSpreadRule,
		"no-object-parameters": noObjectParametersRule,
		"no-reflect-apply": noReflectApplyRule,
		"no-reflect-get": noReflectGetRule,
		"no-shape-in-symbol-names": noForbiddenTermInSymbolNamesRule,
		"no-unknown-type-aliases": noUnknownTypeAliasesRule,
		"no-widen-then-assert": noWidenThenAssertRule,
	},
});

export default antiSlopPlugin;
