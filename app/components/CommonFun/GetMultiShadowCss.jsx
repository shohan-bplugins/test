export default function getMultiShadowCSS(value, type = "box") {
  let styles = "";

  const list = Array.isArray(value)
    ? value
    : value
      ? [value]
      : [];

  list?.map((item, index) => {
    const {
      hOffset = "0px",
      vOffset = "0px",
      blur = "0px",
      spreed = "0px",
      color = "#dddddd",
      isInset = false,
    } = item || {};

    const inset = isInset ? "inset" : "";
    const offsetBlur = `${parseInt(hOffset)}px ${parseInt(vOffset)}px ${parseInt(blur)}px`;
    const isComa = index + 1 >= value.length ? "" : ", ";

    styles +=
      "text" === type
        ? `${offsetBlur} ${color}${isComa}`
        : `${offsetBlur} ${parseInt(spreed)}px ${color} ${inset}${isComa}`;
  });

  return styles || "none";
}
