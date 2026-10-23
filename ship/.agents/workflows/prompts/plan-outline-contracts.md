<!--
Kit feedback 67, 76 (gsd.contract_check): the manifest contract part of the outline prompt; `ph gsd verify contracts` checks it.
-->
In the manifest `produces` lists every symbol another plan calls or builds on as {symbol, kind, file, signature}: file is inside the plan's owns, signature is the exact interface text the consumers will quote (a method, constructor, widget or provider as it will be written). `consumes` lists {plan, symbol} naming a symbol that plan produces. A precondition a plan needs from another (an ancestor widget, a provider override, a registration) is declared later in the plans as must_haves.key_links `requires`/`provides` entries.
