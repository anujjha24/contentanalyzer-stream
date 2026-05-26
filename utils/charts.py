import plotly.express as px

from .helpers import clean_num


def chart_value(value):
    if isinstance(value, (int, float)):
        return value
    text = str(value or "").strip()
    parts = text.split(":")
    if len(parts) == 3:
        try:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
        except ValueError:
            return 0
    return clean_num(value)


def build_donut_chart(labels, values, title):
    fig = px.pie(
        names=labels,
        values=[chart_value(value) for value in values],
        hole=0.55,
        title=title,
    )
    fig.update_layout(
        margin=dict(l=10, r=10, t=48, b=10),
        legend=dict(orientation="h", yanchor="bottom", y=-0.2, xanchor="center", x=0.5),
    )
    fig.update_traces(textposition="inside", textinfo="percent+label")
    return fig
