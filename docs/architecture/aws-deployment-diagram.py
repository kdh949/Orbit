#!/usr/bin/env python3
"""Render the Orbit AWS deployment architecture with Python diagrams."""

from __future__ import annotations

import argparse
import base64
import re
from pathlib import Path

from diagrams import Cluster, Diagram, Edge
from diagrams.aws.compute import EC2
from diagrams.aws.database import RDSPostgresqlInstance
from diagrams.aws.management import CloudwatchLogs
from diagrams.aws.network import CloudFront, InternetGateway
from diagrams.aws.storage import SimpleStorageServiceS3Bucket
from diagrams.onprem.client import Users
from diagrams.onprem.inmemory import Redis
from diagrams.onprem.network import Internet, Nginx
from diagrams.onprem.vcs import Github
from diagrams.programming.framework import FastAPI
from diagrams.programming.language import TypeScript


FONT = "Apple SD Gothic Neo"

GRAPH_ATTR = {
    "bgcolor": "#FFFFFF",
    "compound": "true",
    "dpi": "180",
    "fontname": FONT,
    "fontsize": "18",
    "labelloc": "t",
    "nodesep": "0.55",
    "pad": "0.4",
    "rankdir": "TB",
    "ranksep": "0.8",
    "splines": "spline",
}

NODE_ATTR = {
    "color": "#64748B",
    "fontcolor": "#0F172A",
    "fontname": FONT,
    "fontsize": "11",
    "penwidth": "1.2",
}

EDGE_ATTR = {
    "arrowsize": "0.75",
    "color": "#475569",
    "fontcolor": "#334155",
    "fontname": FONT,
    "fontsize": "9",
    "penwidth": "1.2",
}

AWS_CLUSTER_ATTR = {
    "bgcolor": "#FFF8ED",
    "fontcolor": "#92400E",
    "fontname": FONT,
    "fontsize": "16",
    "pencolor": "#F59E0B",
    "penwidth": "2.0",
    "style": "rounded",
}

VPC_CLUSTER_ATTR = {
    "bgcolor": "#F7FBFF",
    "fontcolor": "#1E3A8A",
    "fontname": FONT,
    "fontsize": "14",
    "pencolor": "#2563EB",
    "penwidth": "1.8",
    "style": "rounded",
}

PUBLIC_SUBNET_ATTR = {
    "bgcolor": "#F0FDF4",
    "fontcolor": "#166534",
    "fontname": FONT,
    "fontsize": "13",
    "pencolor": "#16A34A",
    "penwidth": "1.5",
    "style": "rounded,dashed",
}

PRIVATE_SUBNET_ATTR = {
    "bgcolor": "#F5F3FF",
    "fontcolor": "#5B21B6",
    "fontname": FONT,
    "fontsize": "13",
    "pencolor": "#7C3AED",
    "penwidth": "1.5",
    "style": "rounded,dashed",
}

EC2_CLUSTER_ATTR = {
    "bgcolor": "#FFFFFF",
    "fontcolor": "#9A3412",
    "fontname": FONT,
    "fontsize": "12",
    "pencolor": "#F97316",
    "penwidth": "1.5",
    "style": "rounded",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--format",
        choices=("png", "svg", "pdf"),
        default="png",
        help="Graphviz output format (default: png)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).with_suffix(""),
        help="Output path without an extension",
    )
    return parser.parse_args()


def flow(label: str = "", **attrs: str) -> Edge:
    """Create an edge with consistent Korean-capable typography."""
    edge_attrs = {
        "arrowsize": "0.75",
        "fontcolor": "#334155",
        "fontname": FONT,
        "fontsize": "9",
        "penwidth": "1.2",
    }
    edge_attrs.update(attrs)
    return Edge(label=label, **edge_attrs)


def embed_svg_images(svg_path: Path) -> None:
    """Make Graphviz SVG output portable by embedding icon PNG files."""
    svg = svg_path.read_text(encoding="utf-8")

    def replace_image(match: re.Match[str]) -> str:
        icon_path = Path(match.group(1))
        if not icon_path.is_file():
            return match.group(0)
        encoded = base64.b64encode(icon_path.read_bytes()).decode("ascii")
        return f'xlink:href="data:image/png;base64,{encoded}"'

    svg_path.write_text(
        re.sub(r'xlink:href="([^"]+)"', replace_image, svg),
        encoding="utf-8",
    )


def render(output: Path, outformat: str) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)

    with Diagram(
        "Orbit AWS Deployment Architecture",
        filename=str(output),
        outformat=outformat,
        show=False,
        graph_attr=GRAPH_ATTR,
        node_attr=NODE_ATTR,
        edge_attr=EDGE_ATTR,
    ):
        users = Users("발표자 · 청중\n브라우저")
        github_actions = Github("GitHub Actions")
        external = Internet("OpenAI · Textract\n· Openverse")

        with Cluster("AWS · ap-northeast-2", graph_attr=AWS_CLUSTER_ATTR):
            cloudfront = CloudFront("CloudFront\nSingle Public Entry Point")
            static_web = SimpleStorageServiceS3Bucket(
                "S3 Static Web\nPrivate · OAC · Versioning"
            )
            assets = SimpleStorageServiceS3Bucket(
                "S3 Assets\nPrivate · Encrypted · Versioning"
            )
            cloudwatch = CloudwatchLogs("CloudWatch Logs")

            with Cluster("VPC · 10.42.0.0/16", graph_attr=VPC_CLUSTER_ATTR):
                internet_gateway = InternetGateway("Internet Gateway")

                with Cluster(
                    "Public Subnet A · 10.42.0.0/24",
                    graph_attr=PUBLIC_SUBNET_ATTR,
                ):
                    with Cluster(
                        "EC2 App Host · Docker Compose",
                        graph_attr=EC2_CLUSTER_ATTR,
                    ):
                        ec2_host = EC2("EC2 Host\nSSM managed")
                        nginx = Nginx("Nginx :80")
                        api = TypeScript("NestJS API :3000")
                        worker = TypeScript("NestJS Worker")
                        python_worker = FastAPI("FastAPI Python\nWorker :8000")
                        redis = Redis("Redis\nBullMQ · Cache")
                        private_redis = Redis(
                            "Private Evidence Redis\nNon-persistent"
                        )

                with Cluster(
                    "Private Subnets A / B",
                    graph_attr=PRIVATE_SUBNET_ATTR,
                ):
                    rds = RDSPostgresqlInstance(
                        "RDS PostgreSQL + pgvector\n"
                        "Private · Encrypted · Single-AZ"
                    )

        users >> flow(label="HTTPS", color="#2563EB") >> cloudfront
        cloudfront >> flow(
            label="기본 · SPA 경로",
            color="#2563EB",
        ) >> static_web
        (
            cloudfront
            >> flow(label="/api/* · /socket.io/*", color="#2563EB")
            >> internet_gateway
            >> flow(color="#2563EB")
            >> nginx
            >> flow(color="#2563EB")
            >> api
        )

        users >> flow(
            label="Presigned PUT / GET",
            style="dashed",
            color="#0F766E",
        ) >> assets

        for service in (api, worker, python_worker):
            service << flow(color="#7C3AED") >> rds

        for service in (api, worker):
            service << flow(color="#D97706") >> redis
            service << flow(
                color="#B45309",
                style="dashed",
            ) >> private_redis

        worker >> flow(
            label="Internal HTTP",
            color="#475569",
        ) >> python_worker

        for service in (api, worker, python_worker):
            service << flow(color="#0F766E") >> assets

        for service in (worker, python_worker):
            service << flow(
                label="AI · OCR · STT",
                color="#BE123C",
            ) >> external

        for service in (api, worker, python_worker, nginx, redis):
            service >> flow(
                style="dashed",
                color="#64748B",
                arrowsize="0.6",
            ) >> cloudwatch

        github_actions >> flow(
            label="OIDC · S3 Sync\n· CloudFront Invalidation",
            style="dashed",
            color="#4F46E5",
        ) >> cloudfront
        github_actions >> flow(
            label="SSM Deploy Command",
            style="dashed",
            color="#4F46E5",
        ) >> ec2_host

    if outformat == "svg":
        embed_svg_images(output.with_suffix(".svg"))


if __name__ == "__main__":
    arguments = parse_args()
    render(arguments.output.resolve(), arguments.format)
