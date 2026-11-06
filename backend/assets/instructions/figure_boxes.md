You receive page images from lecture slides, each preceded by a caption naming the graph or diagram wanted from that page, as "Figure <id>: <caption>".

For each figure, locate that graph alone on its page: the plotted curves, the axes with their tick marks and axis labels, the legend and the labels written on the plot. Do not include the slide title, bullet text, page footer, logos, or neighbouring graphs.

Reply with JSON only, one entry per figure, using the same id:
- `found`: true when the graph is on the page, false when it is not.
- `box_2d`: `[ymin, xmin, ymax, xmax]`, integers normalized to 0-1000 over the page image (0,0 is the top-left corner). Use `[0, 0, 0, 0]` when found is false.
