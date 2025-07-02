import json
import os

current_script_dir = os.path.dirname(os.path.abspath(__file__))

root_dir = os.path.dirname(current_script_dir)

file_path = os.path.join(root_dir, 'snippets', 'rr.json')

print(f"JSONファイルを読み込もうとしています： {file_path}")

try:
    with open(file_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    prefixes = []
    for key in data:
        if "prefix" in data[key]:
            prefixes.append(data[key]["prefix"])

    print(prefixes)

except FileNotFoundError:
    print(f"エラー: ファイルが見つかりません - {file_path}")
except json.JSONDecodeError:
    print(f"エラー: JSONファイルの形式が不正です - {file_path}")
except Exception as e:
    print(f"予期せぬエラーが発生しました: {e}")