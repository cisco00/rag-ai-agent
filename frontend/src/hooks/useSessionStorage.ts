import { useState, useEffect } from 'react';

/**
 * A custom hook that behaves like useState, but also syncs its value with sessionStorage.
 * @param key The key to use in sessionStorage
 * @param initialValue The initial value to use if no value exists in sessionStorage
 * @returns A stateful value, and a function to update it
 */
export function useSessionStorage<T>(key: string, initialValue: T): [T, React.Dispatch<React.SetStateAction<T>>] {
    // Pass initial state function to useState so logic is only executed once
    const [storedValue, setStoredValue] = useState<T>(() => {
        if (typeof window === 'undefined') {
            return initialValue;
        }
        try {
            const item = window.sessionStorage.getItem(key);
            if (item === "undefined") return initialValue;
            return item ? JSON.parse(item) : initialValue;
        } catch (error) {
            console.warn(`Error reading sessionStorage key "${key}":`, error);
            return initialValue;
        }
    });

    // Sync state changes to session storage whenever it updates
    useEffect(() => {
        if (typeof window !== 'undefined') {
            try {
                window.sessionStorage.setItem(key, JSON.stringify(storedValue));
            } catch (error) {
                console.warn(`Error setting sessionStorage key "${key}":`, error);
            }
        }
    }, [key, storedValue]);

    return [storedValue, setStoredValue];
}
