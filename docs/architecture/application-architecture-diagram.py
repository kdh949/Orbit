#!/usr/bin/env python3
"""Render the Orbit application architecture with Python diagrams."""

from __future__ import annotations

import argparse
import base64
import re
from pathlib import Path

from diagrams import Cluster, Diagram, Edge, Node
from diagrams.aws.storage import SimpleStorageServiceS3Bucket
from diagrams.generic.blank import Blank
from diagrams.generic.compute import Rack
from diagrams.onprem.client import Client
from diagrams.onprem.database import PostgreSQL
from diagrams.onprem.inmemory import Redis
from diagrams.onprem.network import Internet
from diagrams.programming.framework import FastAPI, React
from diagrams.programming.language import TypeScript


FONT = "Apple SD Gothic Neo"

GRAPH_ATTR = {
    "bgcolor": "#FFFFFF",
    "compound": "true",
    "dpi": "180",
    "fontname": FONT,
    "fontsize": "18",
    "labelloc": "t",
    "newrank": "true",
    "nodesep": "0.48",
    "pad": "0.4",
    "rankdir": "LR",
    "ranksep": "0.85",
    "splines": "spline",
}

NODE_ATTR = {
    "color": "#64748B",
    "fontcolor": "#0F172A",
    "fontname": FONT,
    "fontsize": "10",
    "penwidth": "1.1",
}

EDGE_ATTR = {
    "arrowsize": "0.7",
    "color": "#475569",
    "fontcolor": "#334155",
    "fontname": FONT,
    "fontsize": "9",
    "penwidth": "1.15",
}

CLIENT_CLUSTER_ATTR = {
    "bgcolor": "#EFF6FF",
    "fontcolor": "#1E3A8A",
    "fontname": FONT,
    "fontsize": "14",
    "pencolor": "#3B82F6",
    "penwidth": "1.8",
    "style": "rounded",
}

API_CLUSTER_ATTR = {
    "bgcolor": "#F5F3FF",
    "fontcolor": "#5B21B6",
    "fontname": FONT,
    "fontsize": "14",
    "pencolor": "#8B5CF6",
    "penwidth": "1.8",
    "style": "rounded",
}

ASYNC_CLUSTER_ATTR = {
    "bgcolor": "#FFF7ED",
    "fontcolor": "#9A3412",
    "fontname": FONT,
    "fontsize": "14",
    "pencolor": "#F97316",
    "penwidth": "1.8",
    "style": "rounded",
}

PYTHON_CLUSTER_ATTR = {
    "bgcolor": "#F0FDF4",
    "fontcolor": "#166534",
    "fontname": FONT,
    "fontsize": "14",
    "pencolor": "#22C55E",
    "penwidth": "1.8",
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


def feature(label: str, *, fillcolor: str, color: str) -> Blank:
    """Create a compact rounded feature box inside an application boundary."""
    return Blank(
        label,
        shape="box",
        style="rounded,filled",
        fillcolor=fillcolor,
        color=color,
        fontcolor="#0F172A",
        fontname=FONT,
        fontsize="9",
        margin="0.12,0.08",
        width="2.25",
        height="0.55",
        penwidth="1.0",
    )


def flow(label: str = "", **attrs: str) -> Edge:
    """Create an edge with consistent Korean-capable typography."""
    edge_attrs = {
        "arrowsize": "0.7",
        "fontcolor": "#334155",
        "fontname": FONT,
        "fontsize": "8",
        "penwidth": "1.15",
    }
    edge_attrs.update(attrs)
    return Edge(label=label, **edge_attrs)


def same_rank(cluster: Cluster, nodes: tuple[Node, ...]) -> None:
    """Place nodes in one vertical column when the graph flows left-to-right."""
    node_ids = "; ".join(f'"{node.nodeid}"' for node in nodes)
    cluster.dot.body.append(f"{{ rank=same; {node_ids}; }}")


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
        "Orbit Application Architecture",
        filename=str(output),
        outformat=outformat,
        show=False,
        graph_attr=GRAPH_ATTR,
        node_attr=NODE_ATTR,
        edge_attr=EDGE_ATTR,
    ):
        with Cluster(
            "React Web Client",
            graph_attr=CLIENT_CLUSTER_ATTR,
        ) as client_cluster:
            client_app = React("React Web Client")
            workspace = feature(
                "Workspace · Auth",
                fillcolor="#DBEAFE",
                color="#60A5FA",
            )
            ai_ui = feature(
                "AI PPT Wizard\nProgressive Preview",
                fillcolor="#DBEAFE",
                color="#60A5FA",
            )
            editor = feature(
                "Konva Editor\nDeck · Notes · Animation",
                fillcolor="#DBEAFE",
                color="#60A5FA",
            )
            presenter = feature(
                "Presenter · Presentation",
                fillcolor="#DBEAFE",
                color="#60A5FA",
            )
            audience = feature(
                "Audience · Activities",
                fillcolor="#DBEAFE",
                color="#60A5FA",
            )
            rehearsal = feature(
                "Rehearsal · Reports",
                fillcolor="#DBEAFE",
                color="#60A5FA",
            )

            client_app >> flow(style="invis", weight="20") >> workspace
            same_rank(
                client_cluster,
                (workspace, ai_ui, editor, presenter, audience, rehearsal),
            )

        with Cluster(
            "NestJS API Application",
            graph_attr=API_CLUSTER_ATTR,
        ) as api_cluster:
            api_app = TypeScript("NestJS API\nApplication")
            core = feature(
                "Auth · Projects · Files · Decks",
                fillcolor="#EDE9FE",
                color="#A78BFA",
            )
            create = feature(
                "Generate Deck · Design Agent\nPPTX · References",
                fillcolor="#EDE9FE",
                color="#A78BFA",
            )
            session = feature(
                "Presentation Sessions\nActivities",
                fillcolor="#EDE9FE",
                color="#A78BFA",
            )
            coach = feature(
                "Rehearsals · Practice\nQ&A · Question Guides",
                fillcolor="#EDE9FE",
                color="#A78BFA",
            )
            realtime = feature(
                "Socket.IO Realtime Gateway",
                fillcolor="#EDE9FE",
                color="#A78BFA",
            )
            job_api = feature(
                "Job Orchestration",
                fillcolor="#EDE9FE",
                color="#A78BFA",
            )

            api_app >> flow(style="invis", weight="20") >> core
            same_rank(
                api_cluster,
                (core, create, session, coach, realtime, job_api),
            )

        with Cluster(
            "NestJS Background Worker",
            graph_attr=ASYNC_CLUSTER_ATTR,
        ) as async_cluster:
            async_app = TypeScript("NestJS Background\nWorker")
            queues = feature(
                "BullMQ Queue Consumers",
                fillcolor="#FFEDD5",
                color="#FB923C",
            )
            ai_orch = feature(
                "AI Deck Orchestrator\nStage · Checkpoint · Retry",
                fillcolor="#FFEDD5",
                color="#FB923C",
            )
            pptx = feature(
                "PPTX Import · Sync · Export",
                fillcolor="#FFEDD5",
                color="#FB923C",
            )
            analysis = feature(
                "STT · Analysis · Coaching",
                fillcolor="#FFEDD5",
                color="#FB923C",
            )
            recovery = feature(
                "Retention · Recovery",
                fillcolor="#FFEDD5",
                color="#FB923C",
            )

            async_app >> flow(style="invis", weight="20") >> queues
            queues >> flow(color="#EA580C") >> ai_orch
            queues >> flow(color="#EA580C") >> pptx
            queues >> flow(color="#EA580C") >> analysis
            queues >> flow(color="#EA580C") >> recovery
            same_rank(
                async_cluster,
                (ai_orch, pptx, analysis, recovery),
            )

        with Cluster(
            "FastAPI Python Worker",
            graph_attr=PYTHON_CLUSTER_ATTR,
        ) as python_cluster:
            python_app = FastAPI("FastAPI Python\nWorker")
            grounding = feature(
                "Extraction · OCR\nReference Retrieval",
                fillcolor="#DCFCE7",
                color="#4ADE80",
            )
            generation = feature(
                "Content · Cover · Design\nLayout · Slide Compose",
                fillcolor="#DCFCE7",
                color="#4ADE80",
            )
            doc = feature(
                "PPTX OOXML\nVisual QA",
                fillcolor="#DCFCE7",
                color="#4ADE80",
            )
            speech = feature(
                "STT · Speech Analysis\nCoaching · Semantic Evaluation",
                fillcolor="#DCFCE7",
                color="#4ADE80",
            )

            python_app >> flow(style="invis", weight="20") >> grounding
            same_rank(
                python_cluster,
                (grounding, generation, doc, speech),
            )

        contract = Rack(
            "Shared Contract Layer\n"
            "Zod Schema · editor-core · realtime\n"
            "job-queue · storage · AI ports"
        )
        postgres = PostgreSQL(
            "PostgreSQL + pgvector\nDomain · Job · Stage · Vector"
        )
        redis = Redis("Redis · BullMQ")
        evidence = Redis("Private Evidence Redis")
        assets = SimpleStorageServiceS3Bucket("S3 Assets")
        providers = Internet("OpenAI · Textract · Openverse")
        browser_stt = Client("Browser Live STT")

        api_app >> flow(
            style="invis",
            weight="100",
            minlen="2",
        ) >> async_app
        async_app >> flow(
            style="invis",
            weight="100",
            minlen="2",
        ) >> python_app

        client_app >> flow(
            label="REST",
            color="#2563EB",
            weight="100",
            minlen="2",
        ) >> api_app
        client_app << flow(label="Socket.IO", color="#7C3AED") >> realtime
        presenter >> flow(
            style="dashed",
            color="#0F766E",
        ) >> browser_stt

        job_api >> flow(label="Enqueue", color="#D97706") >> redis
        redis >> flow(label="Consume", color="#D97706") >> queues

        ai_orch >> flow(color="#475569") >> python_app
        pptx >> flow(color="#475569") >> doc
        analysis >> flow(color="#475569") >> speech

        for api_feature in (core, create, session, coach):
            api_feature << flow(color="#7C3AED") >> postgres
        async_app << flow(color="#7C3AED") >> postgres
        python_app << flow(color="#7C3AED") >> postgres

        for application in (api_app, async_app, python_app):
            application << flow(color="#0F766E") >> assets

        analysis << flow(
            style="dashed",
            color="#B45309",
        ) >> evidence
        coach << flow(
            style="dashed",
            color="#B45309",
        ) >> evidence

        python_app << flow(
            label="AI · OCR · STT",
            color="#BE123C",
        ) >> providers

        for application in (client_app, api_app, async_app, python_app):
            contract >> flow(
                style="dashed",
                color="#64748B",
                arrowsize="0.55",
            ) >> application

    if outformat == "svg":
        embed_svg_images(output.with_suffix(".svg"))


if __name__ == "__main__":
    arguments = parse_args()
    render(arguments.output.resolve(), arguments.format)
