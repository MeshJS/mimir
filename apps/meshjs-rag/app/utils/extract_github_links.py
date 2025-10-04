from typing import List

def extract_github_links(text: str) -> List[str]:
    lines = text.splitlines()
    github_links = []

    for line in lines:
        if "https://github.com/MeshJS/" in line:
            github_links.append(line.strip())

    return github_links