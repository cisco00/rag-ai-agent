
const API_BASE_URL = import.meta.env.PROD ? '' : 'http://localhost:8000';

export interface RegisterResponse {
    message: string;
    name: string;
    api_key: string;
    instruction: string;
}

export interface ConfigResponse {
    status: string;
    message: string;
}

export const api = {
    async register(name: string): Promise<RegisterResponse> {
        const response = await fetch(`${API_BASE_URL}/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ name }),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Registration failed');
        }

        return response.json();
    },

    async configureDatabase(connectionString: string, apiKey: string): Promise<ConfigResponse> {
        const response = await fetch(`${API_BASE_URL}/config`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-KEY': apiKey,
            },
            body: JSON.stringify({ connection_string: connectionString }),
        });

        if (!response.ok) {
            const error = await response.json();
            // Pass the full error detail object if available
            throw error.detail || new Error('Configuration failed');
        }

        return response.json();
    },

    async createDatabase(payload: any, apiKey: string): Promise<any> {
        const response = await fetch(`${API_BASE_URL}/database/create-postgres`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-KEY': apiKey,
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to create database');
        }

        return response.json();
    },

    async importBatch(files: File[], apiKey: string, cleaningOptions?: any): Promise<any> {
        const formData = new FormData();
        files.forEach((file) => formData.append('files', file));

        if (cleaningOptions) {
            formData.append('cleaning_options', JSON.stringify(cleaningOptions));
        }

        const response = await fetch(`${API_BASE_URL}/import/batch`, {
            method: 'POST',
            headers: {
                'X-API-KEY': apiKey,
            },
            body: formData,
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Import failed');
        }

        return response.json();
    },

    async analyzeFile(file: File, apiKey: string): Promise<any> {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch(`${API_BASE_URL}/analyze-file`, {
            method: 'POST',
            headers: {
                'X-API-KEY': apiKey,
            },
            body: formData,
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Analysis failed');
        }

        return response.json();
    },

    async getTables(apiKey: string): Promise<any> {
        const response = await fetch(`${API_BASE_URL}/tables`, {
            method: 'GET',
            headers: {
                'X-API-KEY': apiKey,
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to fetch tables');
        }

        return response.json();
    },

    async getTablePreview(tableName: string, apiKey: string): Promise<any> {
        const response = await fetch(`${API_BASE_URL}/tables/${tableName}/preview`, {
            method: 'GET',
            headers: {
                'X-API-KEY': apiKey,
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to fetch table preview');
        }

        return response.json();
    },

    async query(payload: { query: string; history: any[]; verify_only?: boolean; confirmed_sql?: string }, apiKey: string): Promise<any> {
        const response = await fetch(`${API_BASE_URL}/query`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-KEY': apiKey,
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Query failed');
        }

        return response.json();
    },

    async duplicateTable(tableName: string, apiKey: string): Promise<any> {
        const response = await fetch(`${API_BASE_URL}/tables/${tableName}/duplicate`, {
            method: 'POST',
            headers: {
                'X-API-KEY': apiKey,
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to duplicate table');
        }

        return response.json();
    },

    async updateTableCell(tableName: string, rowId: any, col: string, value: any, apiKey: string): Promise<void> {
        const response = await fetch(`${API_BASE_URL}/tables/${tableName}/cell`, {
            method: 'PATCH',
            headers: {
                'X-API-KEY': apiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                row_id: rowId,
                column: col,
                value: value
            }),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to update cell');
        }
    },
    async renameColumn(tableName: string, oldCol: string, newCol: string, apiKey: string): Promise<void> {
        const response = await fetch(`${API_BASE_URL}/tables/${tableName}/columns/rename`, {
            method: 'POST',
            headers: {
                'X-API-KEY': apiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ old_column: oldCol, new_column: newCol }),
        });
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to rename column');
        }
    },

    async dropColumn(tableName: string, col: string, apiKey: string): Promise<void> {
        const response = await fetch(`${API_BASE_URL}/tables/${tableName}/columns/${col}`, {
            method: 'DELETE',
            headers: { 'X-API-KEY': apiKey },
        });
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to drop column');
        }
    },

    async deleteRow(tableName: string, rowId: any, apiKey: string): Promise<void> {
        const response = await fetch(`${API_BASE_URL}/tables/${tableName}/rows/${rowId}`, {
            method: 'DELETE',
            headers: { 'X-API-KEY': apiKey },
        });
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to delete row');
        }
    },
    async fillMissingValues(tableName: string, col: string, strategy: 'value' | 'mean' | 'mode' | 'median' | 'weighted_mean', value: any, apiKey: string, weightColumn?: string): Promise<any> {
        const response = await fetch(`${API_BASE_URL}/tables/${tableName}/columns/${col}/fill`, {
            method: 'POST',
            headers: {
                'X-API-KEY': apiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ strategy, value, weight_column: weightColumn }),
        });
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to fill missing values');
        }
        return response.json();
    },
    async deleteTable(tableName: string, apiKey: string): Promise<void> {
        const response = await fetch(`${API_BASE_URL}/tables/${tableName}`, {
            method: 'DELETE',
            headers: { 'X-API-KEY': apiKey },
        });
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to delete table');
        }
    },
    async getStats(apiKey: string): Promise<any> {
        if (!apiKey) throw new Error("API key is required");
        const response = await fetch(`${API_BASE_URL}/stats`, {
            method: 'GET',
            headers: {
                'X-API-KEY': apiKey,
                'Content-Type': 'application/json',
            },
        });
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to fetch stats');
        }
        return response.json();
    },

    async getScheduledReports(apiKey: string): Promise<any> {
        const response = await fetch(`${API_BASE_URL}/scheduled-reports`, {
            method: 'GET',
            headers: {
                'X-API-KEY': apiKey,
                'Content-Type': 'application/json',
            },
        });
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to fetch scheduled reports');
        }
        return response.json();
    },

    async createScheduledReport(payload: { query: string; frequency: string; recipients: string }, apiKey: string): Promise<any> {
        const response = await fetch(`${API_BASE_URL}/scheduled-reports`, {
            method: 'POST',
            headers: {
                'X-API-KEY': apiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to schedule report');
        }
        return response.json();
    },

    async deleteScheduledReport(reportId: number, apiKey: string): Promise<void> {
        const response = await fetch(`${API_BASE_URL}/scheduled-reports/${reportId}`, {
            method: 'DELETE',
            headers: {
                'X-API-KEY': apiKey,
            },
        });
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to delete scheduled report');
        }
    },

    async exportPPTX(payload: { query: string, response: string, visualization: any, status: string }, apiKey: string): Promise<Blob> {
        const response = await fetch(`${API_BASE_URL}/export/pptx`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-KEY': apiKey,
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to export PPTX');
        }

        return response.blob();
    }
};
