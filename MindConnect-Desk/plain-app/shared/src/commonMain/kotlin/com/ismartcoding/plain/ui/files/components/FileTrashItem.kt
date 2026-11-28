package com.ismartcoding.plain.ui.files.components

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.ismartcoding.plain.models.File

@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun FileTrashItem(
    file: File,
    isSelected: Boolean,
    isSelectMode: Boolean,
    onToggle: () -> Unit,
) {
    ListItem(
        modifier = Modifier.fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 4.dp)
            .clip(MaterialTheme.shapes.extraSmall)
            .combinedClickable(onClick = onToggle, onLongClick = onToggle),
        headlineContent = { Text(file.name) },
        supportingContent = {
            Text(file.url, maxLines = 1, overflow = TextOverflow.Ellipsis)
        },
        leadingContent = if (isSelectMode) {
            { Checkbox(checked = isSelected, onCheckedChange = null) }
        } else null,
    )
}
