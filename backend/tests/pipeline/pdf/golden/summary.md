# סיכום: למידת מכונה

טקסט עברי רגיל עם **מודגש**, *נטוי*, ~~מחוק~~ ו-`קוד בשורה`, ומונח באנגלית: gradient descent.

## ביטויים מעורבים

ביצוע Pull Request על Visual Studio Code, ואז 3-way merge של הענף. הגודל הוא 4KB ו-0.5ms (Software 1.0), כמו console.log('hi') ו-arr[i].

הכתובת https://example.com/a?b=1&c=2 היא קישור גולמי, והנתיב /index.html הוא קובץ. גם \textbf{Bayes' Rule} מודגש, וגם \emph{Tukey's} נטוי.

הרשימה `98, 183, 37` והקוד `awk '{print $1}'` נשארים משמאל לימין, וכך גם ``a ` b``.

## כותרת משנה

::: definition
הגדרה: פונקציה קמורה היא פונקציה שכל מיתר שלה נמצא מעל הגרף.
:::

::: warning
אזהרה: שיטה זו לא מתכנסת עבור $\alpha$ גדול מדי.
:::

::: insight
תובנה: אפשר לראות את זה כהטלה אורתוגונלית של $x$ על Hilbert Space.
:::

::: note
מחלקה לא מוכרת נופלת חזרה לטקסט רגיל.
:::

נוסחה בשורה $e^{i\pi} + 1 = 0$, וגם $_exit$ כמזהה, ו-$\text{Hello world}$ עם $\text{שלב אחד}$ ו-$240 \text{ תאים}$ וגם ה-$init$ (PID 1).

נוסחה מוצגת:

$$\sum_{i=1}^{n} \frac{x_i - \mu}{\sigma} \le \int_0^\infty e^{-t^2}\,dt \quad \forall x \in \mathbb{R}^n$$

$$\llbracket x \rrbracket$$

$$\begin{pmatrix} a & b \\ c & d \end{pmatrix} \otimes \aleph_0 \Rightarrow \bigcup_{k} A_k$$

$$A\mathbf{x} - x_0 \mathbf{1} \le \mathbf{b}_{\mathbf{i}_{\mathbf{j}}}$$

$$\frac{\cancel{a}\,b}{\cancel{a}} = b$$

| עמודה א | עמודה ב | Value |
| ------- | ------- | ----- |
| ערך     | ערך שני | 3.14  |
| שורה    | נוספת   | 42    |

| ימין | מרכז | שמאל |
| ---: | :--: | :--- |
| א    | ב    | ג    |

| שורה ארוכה | הסבר |
| :--- | :--- |
| טקסט ארוך מאוד בתא הראשון של הטבלה | טקסט ארוך מאוד בתא השני של הטבלה כדי לחצות שבעים ושתיים עמודות |

+-------+-----+
| עמודה | ערך |
+=======+=====+
| מאוחד | א   |
|       +-----+
|       | ב   |
+-------+-----+

```python
def gradient_descent(x0, alpha=0.01, eps=1e-8):
    """A very long line intended to exceed the text width so that fvextra breaklines has something real to break, with symbols like <=> and ||."""
    x = x0
    while abs(grad(x)) > eps:
        x -= alpha * grad(x)
    return x
```

```pseudocode
repeat until done: step(x)
```

```
plain fence with no language, so no highlighting macros apply
```

~~~js
app.get('/', (req, res) => { res.send("hi") })
~~~

1. פריט ממוספר
   - תת-פריט
   - עוד אחד
2. פריט שני

סעיפים:
- ראשון עם Git
- שני

> ציטוט מוסגר עם הערת שוליים.[^1]

[^1]: זו הערת השוליים.

קישור ל[אתר](https://example.com) וכתובת גולמית <https://example.com/very/long/path/that/should/wrap>.

---

Term
:   הגדרה של המונח

H~2~O ו-x^2^ .

![תרשים](probe.png)

```bash
arp -n
rm -d dir
ls -q -s -g
```

הפקודה `grep -r foo` מופיעה כאן, ובאנגלית: Bayes rule.

### אלגוריתם $W\text{-}A^*$

טקסט אחרי הכותרת.
