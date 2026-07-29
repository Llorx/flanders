export function settleThenSchedule<T>(value:T, afterSettlement:() => void):Promise<T> {
    return {
        then(resolve:(value:T) => void) {
            resolve(value);
            void Promise.resolve().then(afterSettlement);
        }
    } as unknown as Promise<T>;
}

export function rejectThenSchedule(error:Error, afterSettlement:() => void):Promise<never> {
    return {
        then(_resolve:() => void, reject:(error:Error) => void) {
            reject(error);
            void Promise.resolve().then(afterSettlement);
        }
    } as unknown as Promise<never>;
}
