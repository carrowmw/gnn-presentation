# conceptual_build_script.py
import os
from pathlib import Path
import shutil
import re
from bs4 import BeautifulSoup
import argparse
import tempfile
import glob

# --- Configuration ---
# Attributes to check for local file paths
ATTRS_TO_CHECK = {
    'link': 'href',    # CSS
    'script': 'src',   # JS
    'img': 'src',      # Images
    'source': 'src',   # For <video>/<audio> <source> tags
    'video': 'poster', # Poster images for videos
    'iframe': 'src',   # Local HTML iframes
    'section': 'data-background-image', # Reveal.js background images
    # Add other tags/attributes if your presentations use them for assets
}

MAX_JSON_MB = int(os.environ.get("MAX_JSON_MB", "95"))

# --- Helper Functions ---

def get_asset_path(base_dir, asset_url, current_file_path):
    """
    Resolves the absolute path of an asset.
    Handles relative paths from the current file or root-relative paths.
    """
    if not asset_url or asset_url.startswith(('http:', 'https:', 'data:', '//')):
        return None # External or data URI

    # If asset_url starts with '/', it's relative to base_dir (project root)
    # Otherwise, it's relative to the directory of current_file_path
    if asset_url.startswith('/'):
        abs_path = os.path.join(base_dir, asset_url.lstrip('/'))
    else:
        current_dir = os.path.dirname(current_file_path)
        abs_path = os.path.normpath(os.path.join(current_dir, asset_url))

    return abs_path

def copy_asset(src_abs_path, base_input_dir, output_dir):
    """
    Copies an asset to the output directory, maintaining relative structure.
    Returns the new relative path for the asset in the build.
    """
    if not os.path.exists(src_abs_path):
        print(f"Warning: Asset not found: {src_abs_path}")
        return None

    # Determine relative path from the base_input_dir to the asset
    # This relative path will be recreated in the output_dir
    rel_path = os.path.relpath(src_abs_path, base_input_dir)
    dest_abs_path = os.path.join(output_dir, rel_path)

    os.makedirs(os.path.dirname(dest_abs_path), exist_ok=True)
    shutil.copy2(src_abs_path, dest_abs_path)
    print(f"Copied: {src_abs_path} -> {dest_abs_path}")
    return rel_path # This is the path to use in the modified HTML

def process_css_file(css_abs_path, base_input_dir, output_dir):
    """
    Parses a CSS file for url(...) assets and copies them.
    Note: This is a simplified CSS parser. For complex cases, it might need enhancement.
    It doesn't rewrite paths within CSS files in this simplified version,
    but assumes relative paths will work if structure is maintained.
    """
    if not os.path.exists(css_abs_path):
        return

    print(f"Processing CSS file: {css_abs_path}")
    css_dir = os.path.dirname(css_abs_path)

    try:
        with open(css_abs_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"Warning: Could not read CSS file {css_abs_path}: {e}")
        return

    # Regex to find url(...) patterns. This is basic and might need refinement.
    # It tries to capture unquoted, single-quoted, and double-quoted URLs.
    # It explicitly excludes data URIs.
    matches = re.findall(r'url\((?!["\']?data:)["\']?([^)"\']+)["\']?\)', content)

    for asset_url in matches:
        asset_url = asset_url.strip() # Clean up whitespace
        if not asset_url or asset_url.startswith(('http:', 'https:', '//')): # External
            continue

        # Resolve path relative to the CSS file itself
        asset_abs_path = os.path.normpath(os.path.join(css_dir, asset_url))

        # Check if this asset is within the base_input_dir to avoid copying system files
        if os.path.commonpath([asset_abs_path, base_input_dir]) == base_input_dir:
            copied_rel_path = copy_asset(asset_abs_path, base_input_dir, output_dir)
            # For a full solution, you'd also rewrite the URL in the copied CSS file
            # if its relative path changes significantly, or use absolute paths in build.
            # This example assumes simple relative paths like '../fonts' will be maintained.
        else:
            print(f"Warning: CSS asset path {asset_abs_path} is outside project base. Skipping.")


def find_source_html(name: str) -> Path:
    """
    Try common locations for a presentation named <name>.
    Also consider a top-level index.html if it exists.
    """
    root = Path.cwd()
    candidates = [
        root / f"{name}.html",
        root / "archive" / f"{name}.html",
        root / name / "index.html",
        root / "presentations" / name / "index.html",
        root / "slides" / name / "index.html",
        root / "builds" / f"{name}_build" / "index.html",
        root / "index.html",  # fallback: top-level index.html
    ]
    for p in candidates:
        if p.exists():
            return p
    raise FileNotFoundError(
        f"No source HTML found for name '{name}'. Tried:\n" + "\n".join(str(p) for p in candidates)
    )

def find_project_root(start_dir: str) -> str:
    """
    Walk up until a Git root or filesystem root is found.
    """
    cur = os.path.abspath(start_dir)
    while True:
        if os.path.isdir(os.path.join(cur, ".git")):
            return cur
        parent = os.path.dirname(cur)
        if parent == cur:
            return cur
        cur = parent

def determine_base_input_dir(input_html_file: str) -> str:
    """
    Choose a base directory that contains shared assets like dist/, plugin/, images/, pdf/, css/, js/.
    Start from the HTML dir and walk up until we find one.
    """
    wanted = {"dist", "plugin", "images", "pdf", "css", "js"}
    html_dir = os.path.dirname(os.path.abspath(input_html_file))
    cur = html_dir
    project_root = find_project_root(html_dir)
    while True:
        if any(os.path.isdir(os.path.join(cur, d)) for d in wanted):
            return cur
        if cur == project_root:
            return cur
        parent = os.path.dirname(cur)
        if parent == cur:
            return html_dir
        cur = parent

def process_html_file(html_file_path, base_input_dir, output_dir):
    """
    Processes a single HTML file: copies its assets and the file itself.
    This function would be called recursively for HTML iframes.
    """
    if not os.path.exists(html_file_path):
        print(f"Error: HTML file not found: {html_file_path}")
        return

    print(f"Processing HTML file: {html_file_path}")

    try:
        with open(html_file_path, 'r', encoding='utf-8') as f:
            soup = BeautifulSoup(f, 'html.parser')
    except Exception as e:
        print(f"Warning: Could not parse HTML file {html_file_path}: {e}")
        return

    # Copy assets linked in the HTML
    for tag_name, attr_name in ATTRS_TO_CHECK.items():
        for tag in soup.find_all(tag_name):
            asset_url = tag.get(attr_name)
            if asset_url:
                # FIX: use base_input_dir instead of undefined base_dir
                asset_abs_path = get_asset_path(base_input_dir, asset_url, html_file_path)
                if asset_abs_path:
                    if os.path.commonpath([asset_abs_path, base_input_dir]) == base_input_dir:
                        copied_rel_path = copy_asset(asset_abs_path, base_input_dir, output_dir)
                        if copied_rel_path and copied_rel_path.lower().endswith('.css'):
                            process_css_file(os.path.join(output_dir, copied_rel_path), base_input_dir, output_dir)
                        if tag_name == 'iframe' and copied_rel_path and copied_rel_path.lower().endswith(('.html', '.htm')):
                            # process_html_file(asset_abs_path, base_input_dir, output_dir)
                            pass
                    else:
                        print(f"Warning: HTML asset path {asset_abs_path} is outside project base. Skipping.")

    # Copy the HTML file itself to the build root as index.html
    os.makedirs(output_dir, exist_ok=True)
    shutil.copy2(html_file_path, os.path.join(output_dir, "index.html"))
    print(f"Copied HTML: {html_file_path} -> {os.path.join(output_dir, 'index.html')}")

def write_no_lfs_gitattributes(build_dir: Path):
    """
    Ensure the build is never LFS-filtered when committed or split to gh-pages.
    This file will land at the root of the gh-pages branch (subtree split).
    """
    ga = build_dir / ".gitattributes"
    ga.write_text(
        "# Disable Git LFS and related filters for this published site\n"
        "* -filter -diff -merge -text\n",
        encoding="utf-8"
    )

def verify_no_lfs_pointers(build_dir: Path):
    """
    Fail the build if any file inside the build dir is still an LFS pointer.
    """
    pointer_sig = "version https://git-lfs.github.com/spec/v1"
    bad = []
    for p in build_dir.rglob("*"):
        if p.is_file():
            try:
                with p.open("rb") as f:
                    head = f.read(200).decode("utf-8", errors="ignore")
                if head.startswith(pointer_sig):
                    bad.append(str(p.relative_to(build_dir)))
            except Exception:
                pass
    if bad:
        raise RuntimeError(
            "Build contains Git LFS pointer files (not raw content):\n"
            + "\n".join(f"  - {x}" for x in bad)
            + "\nRun: git lfs install && git lfs pull, then rebuild."
        )

def make_build_self_contained(build_dir: Path):
    """
    Ensure a build folder contains its own Reveal assets and
    that index.html references them with 'dist/' and 'plugin/'.
    """
    root = Path.cwd()

    # Prefer repo-level dist/ and plugin/ if present, else fall back to a known-good build
    src_dist = root / "dist"
    src_plugin = root / "plugin"
    fallback = root / "builds" / "cupum_build"
    if not src_dist.exists():
        cand = fallback / "dist"
        if cand.exists():
            src_dist = cand
    if not src_plugin.exists():
        cand = fallback / "plugin"
        if cand.exists():
            src_plugin = cand

    # Copy assets into the build
    dst_dist = build_dir / "dist"
    dst_plugin = build_dir / "plugin"
    if src_dist.exists():
        shutil.copytree(src_dist, dst_dist, dirs_exist_ok=True)
    if src_plugin.exists():
        shutil.copytree(src_plugin, dst_plugin, dirs_exist_ok=True)

    # Rewrite ../dist and ../plugin to local paths
    index = build_dir / "index.html"
    if index.exists():
        html = index.read_text(encoding="utf-8")
        html = re.sub(r'href="\.\./dist/', 'href="dist/', html)
        html = re.sub(r'src="\.\./dist/', 'src="dist/', html)
        html = re.sub(r'src="\.\./plugin/', 'src="plugin/', html)
        index.write_text(html, encoding="utf-8")


def copy_html_folder(base_dir: Path, staging_dir: Path):
    """Copy the entire html/ folder (e.g., html/dstl-sept-2025/...) into the build."""
    html_src = base_dir / "html"
    if html_src.exists():
        html_dst = staging_dir / "html"
        # Copy tree while preserving structure
        for src in html_src.rglob("*"):
            if src.is_file():
                rel = src.relative_to(base_dir)
                dst = staging_dir / rel
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dst)
                print(f"Copied HTML: {src} -> {dst}")
    else:
        print("No html/ folder found; skipping.")

def copy_boxicons_fonts(base_dir: Path, staging_dir: Path):
    """
    Ensure Boxicons font files are present in the build root fonts/ directory
    because css/boxicons.min.css expects /fonts/boxicons.*.
    """
    fonts_src = base_dir / "fonts"
    if not fonts_src.exists():
        print("Warning: fonts/ not found at project root; Boxicons fonts may 404.")
        return

    # Copy only boxicons.* files
    dst_dir = staging_dir / "fonts"
    dst_dir.mkdir(parents=True, exist_ok=True)
    copied = 0
    for ext in ("eot", "woff2", "woff", "ttf", "svg"):
        for p in fonts_src.glob(f"boxicons*.{ext}"):
            shutil.copy2(p, dst_dir / p.name)
            print(f"Copied Font: {p} -> {dst_dir / p.name}")
            copied += 1
    if copied == 0:
        print("Warning: No boxicons font files found under fonts/.")

def is_too_large(path: Path, limit_mb: int = MAX_JSON_MB) -> bool:
    try:
        return path.stat().st_size > limit_mb * 1024 * 1024
    except Exception:
        return False

def copy_json_assets(base_dir: Path, staging_dir: Path):
    """
    Copy JSON data files used by visualizations into the build, preserving paths.
    Skips any JSON larger than MAX_JSON_MB.
    """
    patterns = [
        "js/custom/*.json",
        "js/custom/**/*.json",
        "docs/*.json",
        "docs/**/*.json",
        "data/*.json",
        "data/**/*.json",
        "js/custom/*.geojson",
        "js/custom/**/*.geojson",
        "docs/*.geojson",
        "docs/**/*.geojson",
        "data/*.geojson",
        "data/**/*.geojson",
    ]
    for pattern in patterns:
        for src in base_dir.glob(pattern):
            if src.is_file():
                if is_too_large(src):
                    print(f"Skipping large JSON (> {MAX_JSON_MB} MB): {src}")
                    continue
                rel = src.relative_to(base_dir)
                dst = staging_dir / rel
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dst)
                print(f"Copied JSON: {src} -> {dst}")


# --- Main Script Logic ---
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Create a minimal build for a Reveal.js presentation.")
    parser.add_argument("--name", help="Presentation name (e.g., ap2). If set, input/output paths are inferred.")
    parser.add_argument("input_html", nargs="?", help="Path to the main HTML file of the presentation.")
    parser.add_argument("output_dir", nargs="?", help="Directory to store the minimal build.")
    args = parser.parse_args()

    if args.name:
        name = args.name
        src_html = find_source_html(name)
        out_dir = Path("builds") / f"{name}_build"
        input_html_file = str(src_html.resolve())
        output_build_dir = str((Path.cwd() / out_dir).resolve())
    else:
        if not args.input_html or not args.output_dir:
            parser.error("Either --name or both positional arguments <input_html> <output_dir> are required.")
        input_html_file = os.path.abspath(args.input_html)
        output_build_dir = os.path.abspath(args.output_dir)

    # Determine a correct base dir that actually contains assets
    base_input_dir = determine_base_input_dir(input_html_file)
    print(f"Project base directory identified as: {base_input_dir}")

    # Build into a temporary staging dir to avoid deleting input
    staging_dir = output_build_dir + ".tmp"
    if os.path.exists(staging_dir):
        shutil.rmtree(staging_dir)
    os.makedirs(staging_dir)

    # Process HTML and assets into staging
    process_html_file(input_html_file, base_input_dir, staging_dir)

    print("\nMinimal build process complete (staging).")
    print(f"Staged at: {staging_dir}")

    # Ensure data and extra assets are included
    copy_json_assets(Path(base_input_dir), Path(staging_dir))
    copy_html_folder(Path(base_input_dir), Path(staging_dir))
    copy_boxicons_fonts(Path(base_input_dir), Path(staging_dir))

    # Make self-contained (dist/plugin + path rewrites) against staging
    make_build_self_contained(Path(staging_dir))

    # NEW: drop a .gitattributes at build root to disable LFS and verify content
    write_no_lfs_gitattributes(Path(staging_dir))
    verify_no_lfs_pointers(Path(staging_dir))

    # Atomically replace the output dir
    if os.path.exists(output_build_dir):
        shutil.rmtree(output_build_dir)
    os.replace(staging_dir, output_build_dir)
    print(f"Presentation exported to: {output_build_dir}")