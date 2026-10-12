"""Which layers of a published image a pull had to download.

Run the snapshot on the machine being updated, just before `vcm update`;
run the report afterwards (anywhere with network access) for each image:

  docker image inspect $(docker image ls -q | sort -u) > images.json
  python scripts/update_layers.py snapshot before.json < images.json
  python scripts/update_layers.py report before.json video-caption-maker-backend 1.0.4-cuda
  python scripts/update_layers.py report before.json video-caption-maker-frontend 1.0.4

A layer is reused when the daemon already held the same chain of layers up to
it (containerd/Docker key unpacked layers by chain ID), otherwise its
compressed blob is downloaded. Sizes are the compressed sizes from the
registry manifest, i.e. bytes on the wire.
"""
import hashlib
import json
import subprocess
import sys

REGISTRY = "https://ghcr.io/v2/tanush1206"
ACCEPT = ",".join([
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.v2+json",
])


def chains(diff_ids):
    out, chain = [], None
    for d in diff_ids:
        chain = d if chain is None else "sha256:" + hashlib.sha256(f"{chain} {d}".encode()).hexdigest()
        out.append(chain)
    return out


def curl(url, token, accept=ACCEPT):
    return subprocess.run(
        ["curl", "-sfL", "-H", f"Authorization: Bearer {token}", "-H", f"Accept: {accept}", url],
        check=True, capture_output=True,
    ).stdout


def published(repo, tag):
    token = json.loads(subprocess.run(
        ["curl", "-sf", f"https://ghcr.io/token?scope=repository:tanush1206/{repo}:pull"],
        check=True, capture_output=True).stdout)["token"]
    manifest = json.loads(curl(f"{REGISTRY}/{repo}/manifests/{tag}", token))
    if "manifests" in manifest:
        amd64 = next(m for m in manifest["manifests"]
                     if m.get("platform", {}).get("architecture") == "amd64"
                     and m.get("platform", {}).get("os") == "linux")
        manifest = json.loads(curl(f"{REGISTRY}/{repo}/manifests/{amd64['digest']}", token))
    config = json.loads(curl(f"{REGISTRY}/{repo}/blobs/{manifest['config']['digest']}", token, "*/*"))
    return manifest["config"]["digest"], manifest["layers"], config["rootfs"]["diff_ids"]


def main():
    if sys.argv[1] == "snapshot":
        images = json.load(sys.stdin)
        known = sorted({c for i in images for c in chains(i["RootFS"].get("Layers", []))})
        json.dump({"chains": known}, open(sys.argv[2], "w"))
        print(f"{len(images)} images, {len(known)} layer chains")
        return
    before = set(json.load(open(sys.argv[2]))["chains"])
    repo, tag = sys.argv[3], sys.argv[4]
    config, layers, diff_ids = published(repo, tag)
    total = new = 0
    print(f"{repo}:{tag}  image {config}")
    for n, (layer, diff, chain) in enumerate(zip(layers, diff_ids, chains(diff_ids)), 1):
        reused = chain in before
        total += layer["size"]
        new += 0 if reused else layer["size"]
        print(f"  {n:2} {'reused  ' if reused else 'DOWNLOAD'} {layer['size']/1e6:9.1f} MB  {layer['digest']}")
    print(f"  layers {len(layers)}, downloaded {sum(c not in before for c in chains(diff_ids))};"
          f" {new/1e6:.1f} MB of {total/1e6:.1f} MB")


main()
