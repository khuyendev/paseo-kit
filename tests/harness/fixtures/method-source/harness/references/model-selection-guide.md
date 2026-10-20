# Model tier selection guide

`frontier`, `pro`, and `standard` are tier names mapped to real Paseo models in `.agents/harness.defaults.json` (runtime contract section 3). Set a tier in an agent definition's `model:`, with `ph spawn --model` or `ph fanout --model`, or in `opts.model` in a workflow. Choose the model for an agent by four criteria: task **complexity, expected duration, required autonomy, and response speed**. Record the reason for the choice in a comment in the agent definition or orchestrator skill.

`ph` = `node .agents/skills/harness/scripts/paseo_harness.mjs`, run from the project root (see `paseo-runtime.md`).

## Summary decision table

| Model | Selection criteria | Typical work |
|------|----------|----------|
| **frontier** | Long-horizon, autonomous model that plans from a complex goal, carries out multiple steps, and produces a final deliverable | Difficult reasoning, creative work, agent coordination, very difficult work requiring planning through long-term execution |
| **pro** | Reasoning-focused model that deeply analyzes a professional, complex problem and reaches precise judgments and conclusions | Design and architecture, code generation, complex analysis, cross-checking, creative work |
| **standard** | General-purpose model that handles most everyday work in writing, coding, analysis, and research with balance | General writing, coding, research, log parsing, format conversion, static file checks, deployment script execution, simple collection |

## 1. Frontier

**Primary role:** Use it for very difficult work that needs long-term autonomous execution and planning. It does more than answer a question immediately: it understands the goal, plans multiple steps, and carries them through to a final deliverable.

### Work that fits well

**① Long-term work with multiple connected steps** — Use it when work requires carrying out several tasks in sequence rather than ending with one answer.
- Market research → competitor analysis → strategy development → report writing
- Requirements analysis → service architecture design → development plan → deliverable production
- Review multiple documents, then derive an integrated conclusion and action plan
- Design the complete process for a long-term project

The important point is that the individual steps are not separate: **the result of an earlier step affects the next step**.

**② Reviewing large amounts of complex material** — Use it when reviewing large and complex materials together, such as papers, reports, minutes, or technical documents. This applies when the work must go beyond a simple summary and do subsequent work.
- Analyze commonalities and differences across multiple sources
- Identify conflicting claims
- Distinguish key evidence from peripheral information
- Integrate many sources into one logical deliverable

**③ Turning vague ideas into concrete deliverables** — Use it when requirements are not settled and only a rough idea is given, so the model must decide the necessary details and create a deliverable.
- Develop an idea like “a service with this kind of feel” into a business plan
- Design the structure and content of presentation materials from only a general topic
- Turn an incomplete product idea into a feature list and development plan
- Produce a complete report or content when no draft exists

Choose it when **the ability to judge and fill in gaps** matters more than following fixed instructions exactly.

**④ Problems requiring deep reasoning together with planning, coordination, and long-term execution** — Frontier does not necessarily reason more deeply than Pro. Frontier is a better fit when a problem needs deep reasoning together with planning, coordination, and long-term execution.

### When choosing Frontier

- The result requires multiple steps
- It is difficult for the user to specify every procedure directly
- The model must plan the order of work on its own
- A complete deliverable must be created from extensive materials
- A project-level result is needed rather than a short answer

## 2. Pro

**Primary role:** A high-performance reasoning model for deeply analyzing and solving difficult problems. If Frontier fits long-term planning and autonomous execution, Pro fits logically analyzing a bounded problem in depth.

### Work that fits well

**① Complex research and analysis** — Work that must evaluate multiple sources and reach a logical conclusion, not just find information.
- Research a complex industry or market in depth
- Compare and analyze multiple research findings
- Evaluate the strengths and weaknesses of a policy or business strategy
- Analyze causes and effects using data and documents
- Write a conclusion that integrates different perspectives

**② Reviewing long technical documents** — Read and understand documents with many specialist terms and complex structure. Examples include software design documents, system architecture documents, research papers, technical specifications, product requirements, and complex API or development documentation. It fits **understanding logical structure and technical meaning** better than simply shortening a document.

**③ Reviewing research methodology** — Assess whether the method used to obtain a result is valid, as well as the result itself.
- Check whether the study design is appropriate, the sample is sufficient, and the sample is unbiased
- Check whether the measurement method and statistical conclusions have problems
- Review whether the conclusion is overstated relative to the evidence and whether alternative interpretations exist

**④ Coding that independently carries out multiple development steps** — Understand the goal and carry out several development tasks rather than stopping after producing a line or two of code.
- Analyze an existing codebase and investigate causes of errors
- Make changes across multiple files, implement features, and write tests
- Improve code structure and determine the next steps independently during development

### When choosing Pro

- The problem is specialized and difficult, but **its scope is relatively clear**
- Deep logical analysis and review are needed
- Technical documents or papers must be understood accurately
- Weaknesses in research or analysis must be found
- A complex coding or technical problem must be solved

## 3. Standard

**Primary role:** A balanced, general-purpose model that reliably handles most everyday work. Use it for writing, coding, research, and analysis unless the work requires highly complex or specialized judgment.

### Work that fits well

**① Writing and content creation** — Email, blog posts, report drafts, advertising copy, editing or rewriting sentences, presentation scripts, social media content planning, and brainstorming.

**② General coding work** — Writing functions, fixing code errors, developing simple programs, explaining existing code, refactoring, writing test code, and creating data-processing scripts.

**③ Analysis and research** — Preparing topic overviews, comparing products or services, analyzing document content, conducting simple competitor research, extracting key claims, comparing pros and cons, and presenting analysis results in a table or report.

**④ Solving problems with multiple steps** — Divide and carry out a clearly scoped task in multiple steps. Examples include summarizing sources and then writing a presentation, analyzing requirements and then creating code examples, or analyzing data and then explaining the results. Distinguish this from a long-term autonomous project for Frontier.

**⑤ Repetitive and operational work** — Log parsing, format conversion, static file checks, deployment script execution, and simple collection.

### When choosing Standard

- Use it when you are unsure which model to choose. If it is difficult to decide, use standard as the default.
- Use it when everyday work must be handled quickly and reliably.
- Use it when carrying out several kinds of work, such as writing, coding, and research.
- Use it for problems that are neither too simple nor excessively complex.
- Use it when both speed and result quality matter.

## Distinguishing Frontier from Pro

- **Frontier**: Plans the entire task and carries it out autonomously over a long period.
- **Pro**: Deeply reasons about and analyzes a complex problem with a defined scope.

For example, **Pro** fits deeply critiquing one paper, while **Frontier** fits reviewing dozens of papers, developing a research strategy, and producing the final report. Use Frontier when earlier results affect later steps and the model must carry out multiple steps on its own. Use Pro when one clearly scoped problem needs deep analysis.

## Harness application rules

1. **Judge by the work** — Do not choose a model because “this agent is important.” Choose based on the complexity, expected duration, required autonomy, and response speed of the work assigned to the agent.
2. **Do not assign the same model across the board without a reason** — Assigning every agent frontier or pro increases cost. Choose an appropriate model for each agent and record the reason in a comment.
3. **Distinguish the coordination layer from the execution layer** — Even if you use frontier for the layer responsible for planning and coordination (the orchestrating session or supervisor agent), choose a separate model appropriate to each task for the task agents below it. The task agents do not need to use frontier just because the coordination agent does.
4. **Choose a model for each workflow stage** — In a workflow script, use `opts.model` to choose different models at different stages. Use standard for repetitive collection and conversion stages, pro for deep verification, review, and design stages, and frontier for stages that plan and execute over the long term. These are model tiers mapped to the available Paseo models in `.agents/harness.defaults.json`; choose the tier by the work, not by assuming a tier is a distinct model.
