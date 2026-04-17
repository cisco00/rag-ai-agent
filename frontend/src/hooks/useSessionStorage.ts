import React, { useState, useEffect, useRef } from 'react';

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

    // Use a ref to track the last saved value to avoid redundant writes
    const lastSavedValue = useRef(JSON.stringify(storedValue));

    // Debounce the actual write to sessionStorage
    useEffect(() => {
        const handler = setTimeout(() => {
            if (typeof window !== 'undefined') {
                try {
                    const valueToStore = JSON.stringify(storedValue);
                    if (valueToStore !== lastSavedValue.current) {
                        window.sessionStorage.setItem(key, valueToStore);
                        lastSavedValue.current = valueToStore;
                    }
                } catch (error) {
                    console.warn(`Error saving to sessionStorage: ${error}`);
                }
            }
        }, 500); // 500ms debounce

        return () => clearTimeout(handler);
    }, [key, storedValue]);

    return [storedValue, setStoredValue] as const;
}
