import ast

with open('c:/Users/DELL/AI-Model/rag-ai-agent/src/api.py', 'r', encoding='utf-8') as f:
    source = f.read()

tree = ast.parse(source)
endpoints = []
for node in ast.walk(tree):
    if isinstance(node, ast.FunctionDef):
        for dec in node.decorator_list:
            if isinstance(dec, ast.Call) and isinstance(dec.func, ast.Attribute):
                if hasattr(dec.func.value, 'id') and dec.func.value.id in ['app', 'router'] and dec.func.attr in ['get', 'post', 'put', 'delete', 'patch']:
                    method = dec.func.attr.upper()
                    if dec.args and isinstance(dec.args[0], ast.Constant):
                        path = dec.args[0].value
                        endpoints.append(f"{method} {path}")

for e in endpoints:
    print(e)
