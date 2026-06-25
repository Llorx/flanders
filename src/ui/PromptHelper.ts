import type { AskContext, ChoiceOption, OutputContext } from "../contexts";

export type AskChoiceArgs = Readonly<{
    header:string;
    question:string;
    options:readonly ChoiceOption[];
    defaultLabel?:string; // label of the option Enter selects; ignored when it matches no option
}>;

export type AskTextArgs = Readonly<{
    question:string;
    placeholder?:string;
    default?:string; // returned when the user presses Enter on an empty input
}>;

export type AskMultiChoiceArgs = Readonly<{
    header:string;
    question:string;
    options:readonly ChoiceOption[];
    selected?:readonly ChoiceOption[]; // entries toggled on as the initial state; the result when the prompt is accepted unchanged
}>;

function abortError():Error {
    const e = new Error("Aborted");
    e.name = "AbortError";
    return e;
}

export async function askChoice(ask:AskContext, args:AskChoiceArgs, output?:OutputContext):Promise<ChoiceOption> {
    const matchIndex = args.defaultLabel !== undefined
        ? args.options.findIndex(o => o.label === args.defaultLabel)
        : -1;
    const [answer] = await ask.askChoices([{
        header: args.header,
        question: args.question,
        options: args.options,
        multiSelect: false,
        defaultIndex: matchIndex >= 0 ? matchIndex : undefined
    }], output);
    if (!answer || answer.picked.length === 0) {
        throw abortError();
    }
    return answer.picked[0]!;
}

export async function askMultiChoice(ask:AskContext, args:AskMultiChoiceArgs, output?:OutputContext):Promise<readonly ChoiceOption[]> {
    const selectedLabels = new Set((args.selected ?? []).map(o => o.label));
    const defaultIndexes:number[] = [];
    for (let i = 0; i < args.options.length; i++) {
        if (selectedLabels.has(args.options[i]!.label)) {
            defaultIndexes.push(i);
        }
    }
    const [answer] = await ask.askChoices([{
        header: args.header,
        question: args.question,
        options: args.options,
        multiSelect: true,
        defaultIndexes: defaultIndexes.length > 0 ? defaultIndexes : undefined
    }], output);
    if (!answer || answer.picked.length === 0) {
        throw abortError();
    }
    return answer.picked;
}

export async function askText(ask:AskContext, args:AskTextArgs):Promise<string> {
    const prompt = args.placeholder
        ? `${args.question} (${args.placeholder}): `
        : `${args.question}: `;
    let value:string;
    try {
        value = await ask.askText(prompt);
    } catch {
        throw abortError();
    }
    if (value === "" && args.default !== undefined) {
        return args.default;
    }
    return value;
}
