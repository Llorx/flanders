import type { AskContext, ChoiceOption, OutputContext } from "../contexts";
import { abortError, isAbortError, isInputReleasedError } from "../abortError";

const CANCELLED_DIAGNOSTIC = "Prompt cancelled, neighbor.\n";

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

export async function askChoice(ask:AskContext, args:AskChoiceArgs, output?:OutputContext, signal?:AbortSignal):Promise<ChoiceOption> {
    const matchIndex = args.defaultLabel !== undefined
        ? args.options.findIndex(o => o.label === args.defaultLabel)
        : -1;
    const [answer] = await ask.askChoices([{
        header: args.header,
        question: args.question,
        options: args.options,
        multiSelect: false,
        defaultIndex: matchIndex >= 0 ? matchIndex : undefined
    }], output, signal);
    if (signal?.aborted) {
        throw abortError();
    }
    if (!answer || answer.picked.length === 0) {
        throw abortError({ inputReleased: true });
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
        throw abortError({ inputReleased: true });
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
        throw abortError({ inputReleased: true });
    }
    if (value === "" && args.default !== undefined) {
        return args.default;
    }
    return value;
}

// A caller that cancelled the prompt itself already knows why the answer never came, so only the
// user's own release of the input gets the diagnostic. That distinction comes off the abort rather
// than off `signal.aborted`, which by this point reports the teardown abort too.
async function nullOnAbort<T>(prompt:() => Promise<T>, output:OutputContext, signal?:AbortSignal):Promise<T|null> {
    try {
        const value = await prompt();
        return signal?.aborted ? null : value;
    } catch (e) {
        if (isAbortError(e)) {
            if (isInputReleasedError(e)) {
                output.writeError(CANCELLED_DIAGNOSTIC);
            }
            return null;
        }
        throw e;
    }
}

export function tryAskChoice(ask:AskContext, args:AskChoiceArgs, output:OutputContext, signal?:AbortSignal):Promise<ChoiceOption|null> {
    return nullOnAbort(() => askChoice(ask, args, output, signal), output, signal);
}

export function tryAskMultiChoice(ask:AskContext, args:AskMultiChoiceArgs, output:OutputContext):Promise<readonly ChoiceOption[]|null> {
    return nullOnAbort(() => askMultiChoice(ask, args, output), output);
}

export function tryAskText(ask:AskContext, args:AskTextArgs, output:OutputContext):Promise<string|null> {
    return nullOnAbort(() => askText(ask, args), output);
}
