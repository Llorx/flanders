import type { AskContext, ChoiceOption, OutputContext } from "./contexts";

export type AskChoiceArgs = Readonly<{
    header:string;
    question:string;
    options:readonly ChoiceOption[];
}>;

export type AskTextArgs = Readonly<{
    question:string;
    placeholder?:string;
}>;

function abortError():Error {
    const e = new Error("Aborted");
    e.name = "AbortError";
    return e;
}

export async function askChoice(ask:AskContext, args:AskChoiceArgs, output?:OutputContext):Promise<ChoiceOption> {
    const [answer] = await ask.askChoices([{
        header: args.header,
        question: args.question,
        options: args.options,
        multiSelect: false
    }], output);
    if (!answer || answer.picked.length === 0) {
        throw abortError();
    }
    return answer.picked[0]!;
}

export async function askText(ask:AskContext, args:AskTextArgs):Promise<string> {
    const prompt = args.placeholder
        ? `${args.question} (${args.placeholder}): `
        : `${args.question}: `;
    try {
        return await ask.askText(prompt);
    } catch {
        throw abortError();
    }
}
